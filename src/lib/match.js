// CS2 match simulation. Pure 50/50 luck per the design choice. Winning grants
// coins plus a chance at a random skin; losing grants nothing. A cooldown stops
// it becoming spammable free income. Match cooldown is stored on the user row
// (last_match) so it survives restarts.

import { EmbedBuilder } from 'discord.js';
import { chance, rnd, pick } from './fairrng.js';
import { pool, getOrCreateUser } from './db.js';
import { rollSkin } from './skins.js';
import { RARITY_EMOJI } from './visuals.js';
import { navRow } from './components.js';

const MATCH_COOLDOWN_MS = 30 * 60 * 1000; // 30 minutes between matches
const WIN_COINS_MIN = 200;
const WIN_COINS_MAX = 600;
const SKIN_DROP_CHANCE = 0.25;            // 25% chance of a skin on a win

// A few flavour map/score lines so each match reads differently.
const MAPS = ['Mirage', 'Inferno', 'Dust II', 'Nuke', 'Ancient', 'Overpass', 'Anubis'];

export async function playMatch(userId) {
  const user = await getOrCreateUser(userId);

  // Cooldown check.
  if (user.last_match) {
    const elapsed = Date.now() - new Date(user.last_match).getTime();
    if (elapsed < MATCH_COOLDOWN_MS) {
      const rem = MATCH_COOLDOWN_MS - elapsed;
      const m = Math.floor(rem / 60_000);
      const s = Math.floor((rem % 60_000) / 1000);
      return { error: `You're still resting. Next match in ${m}m ${s}s.` };
    }
  }

  // Mark the cooldown immediately (atomic) so a double-click can't play twice.
  const res = await pool.query(
    `UPDATE users SET last_match = NOW()
     WHERE user_id = $1 AND (last_match IS NULL OR last_match <= $2)`,
    [userId, new Date(Date.now() - MATCH_COOLDOWN_MS).toISOString()]
  );
  if (res.rowCount === 0) {
    return { error: 'You\'re still resting — try again shortly.' };
  }

  const map = pick(MAPS);
  const won = chance(0.5); // pure 50/50

  // Animation frames: a short "match in progress" build-up shown before the
  // result. The same frames play whether you win or lose (no spoilers).
  const animation = [
    { embeds: [{ color: 0x95a5a6, title: '🔫 Match in progress', description: `🗺️ **${map}**\n\nWarmup… teams locking in.` }] },
    { embeds: [{ color: 0x95a5a6, title: '🔫 Match in progress', description: `🗺️ **${map}**\n\n🔥 First half underway…` }] },
    { embeds: [{ color: 0x95a5a6, title: '🔫 Match in progress', description: `🗺️ **${map}**\n\n💥 Going to overtime in the players' heads… final round!` }] },
  ];

  if (!won) {
    // Realistic-ish losing scoreline (you scored fewer rounds).
    const enemy = 13;
    const you = rnd(3, 11);
    const embed = new EmbedBuilder().setColor(0xe74c3c)
      .setTitle('🔫 Match Result — Defeat')
      .setDescription(`**${map}** · Final score **${you} : ${enemy}**\n\nYour team lost. No rewards this time — better luck next match.`)
      .setFooter({ text: 'Next match available in 30 minutes' });
    return { animation, payload: { embeds: [embed], components: [navRow()] } };
  }

  // Win: coins, and maybe a skin.
  const coins = rnd(WIN_COINS_MIN, WIN_COINS_MAX);
  const you = 13;
  const enemy = rnd(3, 11);

  // Award coins (respecting storage cap only matters if a skin also drops).
  await pool.query('UPDATE users SET coins = coins + $1 WHERE user_id = $2', [coins, userId]);

  let skinLine = '';
  if (chance(SKIN_DROP_CHANCE)) {
    // Check storage before granting a skin.
    const { rows: [{ count }] } = await pool.query(
      'SELECT COUNT(*) FROM inventory WHERE user_id = $1', [userId]);
    if (Number(count) < user.storage_cap) {
      const drop = await rollSkin();
      await pool.query(
        `INSERT INTO inventory (user_id, skin_id, name, rarity, wear, stattrak, value, image)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [userId, drop.skin_id, drop.name, drop.rarity, drop.wear, drop.stattrak, drop.value, drop.image]);
      const e = RARITY_EMOJI[drop.rarity] ?? '▫️';
      skinLine = `\n🎁 **Skin drop!** ${e} ${drop.stattrak ? 'StatTrak™ ' : ''}**${drop.name}** ` +
        `(${drop.wear}) — worth ${drop.value.toLocaleString()}`;
    } else {
      skinLine = '\n🎁 You earned a skin drop, but your storage is full!';
    }
  }

  const embed = new EmbedBuilder().setColor(0x2ecc71)
    .setTitle('🔫 Match Result — Victory!')
    .setDescription(
      `**${map}** · Final score **${you} : ${enemy}**\n\n` +
      `🏆 Your team won!\n💰 **+${coins.toLocaleString()}** coins${skinLine}`)
    .setFooter({ text: 'Next match available in 30 minutes' });
  return { animation, payload: { embeds: [embed], components: [navRow()] } };
}
