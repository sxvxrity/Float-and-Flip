import { autoEphemeral } from '../lib/ephemeral.js';
import { SlashCommandBuilder, EmbedBuilder, MessageFlags } from 'discord.js';
import { pool, getOrCreateUser } from '../lib/db.js';
import { RARITY_ORDER, WEARS, loadSkins, skinValue } from '../lib/skins.js';
import { color, wearBar, RARITY_EMOJI } from '../lib/visuals.js';

const NEEDED = 10; // skins consumed per trade-up

export const data = new SlashCommandBuilder()
  .setName('tradeup')
  .setDescription(`Trade ${NEEDED} skins of one rarity up to a higher-tier skin`)
  .addStringOption((opt) => {
    opt.setName('rarity').setDescription('Rarity to trade up from').setRequired(true);
    // Last tier can't be traded up, so omit it.
    for (const r of RARITY_ORDER.slice(0, -1)) opt.addChoices({ name: r, value: r });
    return opt;
  });

export async function execute(interaction) {
  const user = await getOrCreateUser(interaction.user.id);
  const rarity = interaction.options.getString('rarity');

  const tierIdx = RARITY_ORDER.indexOf(rarity);
  const nextTier = RARITY_ORDER[tierIdx + 1];
  if (!nextTier) {
    return autoEphemeral(interaction, `${rarity} is the top tier — can't trade up.`);
  }

  // Grab the 10 cheapest of that rarity to consume.
  const { rows: pool10 } = await pool.query(
    `SELECT id FROM inventory WHERE user_id = $1 AND rarity = $2
     ORDER BY value ASC LIMIT $3`,
    [user.user_id, rarity, NEEDED]
  );

  if (pool10.length < NEEDED) {
    return autoEphemeral(interaction, `You need ${NEEDED} **${rarity}** skins to trade up. You have ${pool10.length}.`);
  }

  await interaction.deferReply();

  // Roll the reward skin from the next tier up.
  const skins = await loadSkins();
  const candidates = skins[nextTier];
  const skin = candidates[Math.floor(Math.random() * candidates.length)];
  const wear = WEARS[Math.floor(Math.random() * WEARS.length)];
  const stattrak = Math.random() < 0.1;
  const value = skinValue({ rarity: nextTier, wear: wear.name, stattrak });

  const ids = pool10.map((r) => r.id);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Gate on the DELETE: only the rows still present get removed, and
    // RETURNING tells us how many. If a concurrent tradeup/sell/list already
    // took some of these ids, we get fewer than NEEDED back — abort, so we
    // never mint a reward from skins we didn't actually consume.
    const del = await client.query(
      'DELETE FROM inventory WHERE id = ANY($1::int[]) AND user_id = $2 RETURNING id',
      [ids, user.user_id]
    );
    if (del.rows.length < NEEDED) {
      await client.query('ROLLBACK');
      return interaction.editReply(
        'Trade-up failed — some of those skins were just used elsewhere. Try again.'
      );
    }

    await client.query(
      `INSERT INTO inventory (user_id, skin_id, name, rarity, wear, stattrak, value, image)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [user.user_id, skin.id, skin.name, nextTier, wear.name, stattrak, value, skin.image]
    );
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }

  const emoji = RARITY_EMOJI[nextTier] ?? '▫️';
  const embed = new EmbedBuilder()
    .setColor(color(nextTier))
    .setTitle(`${emoji} ${stattrak ? 'StatTrak™ ' : ''}${skin.name}`)
    .setDescription(
      `Traded up **${NEEDED}× ${rarity}** → **${nextTier}**\n` +
      `${wear.name}  \`${wearBar(wear.name)}\``
    )
    .addFields({ name: 'Value', value: `${value.toLocaleString()} coins` })
    .setThumbnail(skin.image || null);

  await interaction.editReply({ embeds: [embed] });
}
