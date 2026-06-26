import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import { pool, getOrCreateUser } from '../lib/db.js';
import { calcPassive, COINS_PER_BOT_PER_HOUR } from '../lib/passive.js';

export const data = new SlashCommandBuilder()
  .setName('invest')
  .setDescription('Collect coins your trade bots earned while you were away');

export async function execute(interaction) {
  const user = await getOrCreateUser(interaction.user.id);

  if (user.trade_bots <= 0) {
    return interaction.reply({
      content:
        'You have no trade bots yet. Buy one with `/upgrade tradebot` to start earning passive income.',
      ephemeral: true,
    });
  }

  const { earned, hours } = calcPassive(user);

  if (earned <= 0) {
    return interaction.reply({
      content: 'Your bots haven\'t earned anything yet — check back in a bit.',
      ephemeral: true,
    });
  }

  // Pay out and reset the clock — but only if last_passive hasn't changed
  // since we read it. If a parallel /invest already collected, its NOW() write
  // moved last_passive, this WHERE won't match, and we don't double-pay.
  const res = await pool.query(
    `UPDATE users SET coins = coins + $1, last_passive = NOW()
     WHERE user_id = $2 AND last_passive = $3`,
    [earned, user.user_id, new Date(user.last_passive).toISOString()]
  );

  if (res.rowCount === 0) {
    return interaction.reply({
      content: 'Those earnings were just collected. Check back in a bit.',
      ephemeral: true,
    });
  }

  const rate = user.trade_bots * COINS_PER_BOT_PER_HOUR;
  const embed = new EmbedBuilder()
    .setColor(0x2ecc71)
    .setTitle('Trade bots collected')
    .setDescription(
      `🤖 **${user.trade_bots}** bot(s) ran for **${hours.toFixed(1)}h**\n` +
      `Earned **+${earned.toLocaleString()}** coins\n` +
      `Rate: ${rate.toLocaleString()}/hour`
    );

  await interaction.reply({ embeds: [embed] });
}
