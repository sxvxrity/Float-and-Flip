import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import { pool, getOrCreateUser } from '../lib/db.js';
import { rollSkin } from '../lib/skins.js';
import { color, wearBar, RARITY_EMOJI } from '../lib/visuals.js';

const CASE_COST = 250;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export const data = new SlashCommandBuilder()
  .setName('case')
  .setDescription(`Open a case for ${CASE_COST} coins and pull a skin`);

export async function execute(interaction) {
  const user = await getOrCreateUser(interaction.user.id);

  if (user.coins < CASE_COST) {
    return interaction.reply({
      content: `You need ${CASE_COST} coins to open a case. You have ${user.coins}.`,
      ephemeral: true,
    });
  }

  // Check storage cap
  const { rows: [{ count }] } = await pool.query(
    'SELECT COUNT(*) FROM inventory WHERE user_id = $1',
    [user.user_id]
  );
  if (Number(count) >= user.storage_cap) {
    return interaction.reply({
      content: `Your storage is full (${count}/${user.storage_cap}). Sell some skins or upgrade storage.`,
      ephemeral: true,
    });
  }

  await interaction.deferReply();

  const drop = await rollSkin();

  // Persist the result up front (transaction), then play the reveal.
  // The early checks above are just for fast UX — the REAL enforcement is
  // here, inside the transaction, so parallel /case spam can't overspend
  // coins or slip past the storage cap (exploits: negative balance + cap bypass).
  const client = await pool.connect();
  let outcome = 'ok';
  try {
    await client.query('BEGIN');

    // Conditional deduction: only subtracts if the balance still covers it.
    // rowCount === 0 means they no longer have enough (a concurrent spend won).
    const pay = await client.query(
      'UPDATE users SET coins = coins - $1 WHERE user_id = $2 AND coins >= $1',
      [CASE_COST, user.user_id]
    );
    if (pay.rowCount === 0) {
      await client.query('ROLLBACK');
      outcome = 'broke';
    } else {
      // Conditional insert: only adds the skin if the user is still under cap.
      // The SELECT COUNT runs inside the same transaction as the INSERT, so
      // concurrent opens can't both see a free slot and both fill it.
      const ins = await client.query(
        `INSERT INTO inventory (user_id, skin_id, name, rarity, wear, stattrak, value, image)
         SELECT $1,$2,$3,$4,$5,$6,$7,$8
         WHERE (SELECT COUNT(*) FROM inventory WHERE user_id = $1) < $9`,
        [user.user_id, drop.skin_id, drop.name, drop.rarity, drop.wear,
         drop.stattrak, drop.value, drop.image, user.storage_cap]
      );
      if (ins.rowCount === 0) {
        // Over cap — refund the case cost and abort.
        await client.query('ROLLBACK');
        outcome = 'full';
      } else {
        await client.query('COMMIT');
      }
    }
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }

  if (outcome === 'broke') {
    return interaction.editReply(`You no longer have ${CASE_COST} coins to open a case.`);
  }
  if (outcome === 'full') {
    return interaction.editReply(
      `Your storage is full (${user.storage_cap}/${user.storage_cap}). Sell some skins or upgrade storage.`
    );
  }

  // --- Reveal animation: edit the message a few times for suspense ---
  // Skipped entirely if the user has fast mode on (/settings fastmode).
  if (!user.fast_mode) {
    const reel = ['⬜', '🟦', '🟪', '🟥', '🟨'];
    const spin = (n) =>
      Array.from({ length: 7 }, () => reel[Math.floor(Math.random() * Math.min(reel.length, n))]).join(' ');

    const opening = new EmbedBuilder().setColor(0x95a5a6).setTitle('🎁 Opening case…');

    await interaction.editReply({ embeds: [opening.setDescription(`\`${spin(5)}\``)] });
    await sleep(900);
    await interaction.editReply({ embeds: [opening.setDescription(`\`${spin(4)}\``)] });
    await sleep(900);
    await interaction.editReply({ embeds: [opening.setDescription(`\`${spin(3)}\``).setTitle('🎁 Almost…')] });
    await sleep(900);
  }

  // --- Final result ---
  const emoji = RARITY_EMOJI[drop.rarity] ?? '▫️';
  const title = `${emoji} ${drop.stattrak ? 'StatTrak™ ' : ''}${drop.name}`;
  const result = new EmbedBuilder()
    .setColor(color(drop.rarity))
    .setTitle(title)
    .setDescription(`**${drop.rarity}**\n${drop.wear}  \`${wearBar(drop.wear)}\``)
    .addFields({ name: 'Value', value: `${drop.value.toLocaleString()} coins`, inline: true })
    .setThumbnail(drop.image || null);

  const isRare = ['Covert', 'Extraordinary'].includes(drop.rarity);
  await interaction.editReply({
    content: isRare ? `🎉 ${interaction.user} just unboxed something rare!` : '',
    embeds: [result],
  });
}
