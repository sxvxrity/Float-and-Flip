import { SlashCommandBuilder, EmbedBuilder, MessageFlags } from 'discord.js';
import { pool, getOrCreateUser } from '../lib/db.js';
import { rollSkin } from '../lib/skins.js';
import { autoEphemeral } from '../lib/ephemeral.js';

const COOLDOWN_HOURS = 20;
const COIN_GIFT_MIN = 200;
const COIN_GIFT_MAX = 800;
const SKIN_CHANCE = 0.4; // 40% chance of a skin, 60% coins

export const data = new SlashCommandBuilder()
  .setName('gift')
  .setDescription('Send a surprise gift to another player — coins or a skin, generated for free')
  .addUserOption((o) =>
    o.setName('user').setDescription('Who to gift').setRequired(true));

export async function execute(interaction) {
  const target = interaction.options.getUser('user');

  // Can't gift yourself.
  if (target.id === interaction.user.id) {
    return autoEphemeral(interaction, '❌ You can\'t gift yourself.');
  }

  // Can't gift bots.
  if (target.bot) {
    return autoEphemeral(interaction, '❌ You can\'t gift a bot.');
  }

  // Atomic cooldown check + claim in one query — prevents race conditions from
  // duplicate slash command submissions.
  const COOLDOWN_MS = COOLDOWN_HOURS * 3_600_000;
  const cutoff = new Date(Date.now() - COOLDOWN_MS).toISOString();
  const cooldownRes = await pool.query(
    `UPDATE users SET last_gift = NOW()
     WHERE user_id = $1 AND (last_gift IS NULL OR last_gift <= $2)
     RETURNING last_gift`,
    [interaction.user.id, cutoff]);

  if (cooldownRes.rowCount === 0) {
    const sender = await getOrCreateUser(interaction.user.id);
    const elapsed = Date.now() - new Date(sender.last_gift).getTime();
    const rem = Math.max(0, COOLDOWN_MS - elapsed);
    const h = Math.floor(rem / 3_600_000);
    const m = Math.floor((rem % 3_600_000) / 60_000);
    return autoEphemeral(interaction, `🎁 You already sent a gift today. Next gift available in **${h}h ${m}m**.`);
  }

  // Ensure both users exist in DB.
  await getOrCreateUser(interaction.user.id);
  await getOrCreateUser(target.id);

  // Roll gift type.
  const isSkin = Math.random() < SKIN_CHANCE;

  const embed = new EmbedBuilder().setColor(0xf1c40f)
    .setTitle('🎁 You received a gift!');

  if (isSkin) {
    const skin = await rollSkin();
    await pool.query(
      `INSERT INTO inventory (user_id, skin_id, name, rarity, wear, stattrak, value, image)
       SELECT $1,$2,$3,$4,$5,$6,$7,$8
       WHERE (SELECT COUNT(*) FROM inventory WHERE user_id = $1) < (SELECT storage_cap FROM users WHERE user_id = $1)`,
      [target.id, skin.skin_id, skin.name, skin.rarity, skin.wear, skin.stattrak, skin.value, skin.image]);

    embed.setDescription(
      `**${interaction.user.username}** sent you a skin!\n\n` +
      `🎁 ${skin.stattrak ? 'StatTrak™ ' : ''}**${skin.name}**\n` +
      `${skin.rarity} · ${skin.wear}\n` +
      `Worth **${skin.value.toLocaleString()}** coins`)
      .setThumbnail(skin.image ?? null);
  } else {
    const amount = COIN_GIFT_MIN + Math.floor(Math.random() * (COIN_GIFT_MAX - COIN_GIFT_MIN));
    await pool.query('UPDATE users SET coins = coins + $1 WHERE user_id = $2', [amount, target.id]);
    embed.setDescription(
      `**${interaction.user.username}** sent you a gift!\n\n` +
      `💰 **+${amount.toLocaleString()} coins** added to your balance`);
  }

  embed.setFooter({ text: 'Use /gift to send someone a surprise too!' });

  // Acknowledge the sender's interaction first.
  await interaction.reply({
    content: `🎁 Gift sent to ${target}!`,
    flags: MessageFlags.Ephemeral,
  });
  setTimeout(() => interaction.deleteReply().catch(() => {}), 8000);

  // Send the gift privately to the receiver.
  try {
    await target.send({ embeds: [embed] });
  } catch {
    // DMs disabled — fall back to an ephemeral in the channel that only they'd see
    // by mentioning them. Best effort.
    await interaction.followUp({
      content: `${target}`,
      embeds: [embed],
      flags: MessageFlags.Ephemeral,
    }).catch(() => {});
  }
}
