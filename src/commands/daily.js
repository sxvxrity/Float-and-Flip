import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import { pool, getOrCreateUser } from '../lib/db.js';

const DAILY_BASE = 500;
const COOLDOWN_MS = 20 * 3_600_000; // 20h so a daily habit doesn't drift later each day

export const data = new SlashCommandBuilder()
  .setName('daily')
  .setDescription('Claim your daily coin bonus');

export async function execute(interaction) {
  const user = await getOrCreateUser(interaction.user.id);

  if (user.last_daily) {
    const elapsed = Date.now() - new Date(user.last_daily).getTime();
    if (elapsed < COOLDOWN_MS) {
      const remaining = COOLDOWN_MS - elapsed;
      const h = Math.floor(remaining / 3_600_000);
      const m = Math.floor((remaining % 3_600_000) / 60_000);
      return interaction.reply({
        content: `Already claimed. Come back in **${h}h ${m}m**.`,
        ephemeral: true,
      });
    }
  }

  // Small random bonus on top of the base so it feels less flat.
  const bonus = Math.floor(Math.random() * 300);
  const total = DAILY_BASE + bonus;

  // The cooldown is enforced IN the UPDATE: it only writes if last_daily is
  // null or older than the cooldown. Two parallel /daily calls can't both
  // claim — only the first matches the WHERE and pays out.
  const cutoff = new Date(Date.now() - COOLDOWN_MS).toISOString();
  const res = await pool.query(
    `UPDATE users SET coins = coins + $1, last_daily = NOW()
     WHERE user_id = $2 AND (last_daily IS NULL OR last_daily <= $3)`,
    [total, user.user_id, cutoff]
  );

  if (res.rowCount === 0) {
    // Someone (or a parallel call) already claimed within the window.
    const elapsed = Date.now() - new Date(user.last_daily).getTime();
    const remaining = Math.max(0, COOLDOWN_MS - elapsed);
    const h = Math.floor(remaining / 3_600_000);
    const m = Math.floor((remaining % 3_600_000) / 60_000);
    return interaction.reply({
      content: `Already claimed. Come back in **${h}h ${m}m**.`,
      ephemeral: true,
    });
  }

  const embed = new EmbedBuilder()
    .setColor(0xf1c40f)
    .setTitle('Daily claimed')
    .setDescription(`💰 **+${total.toLocaleString()}** coins\nCome back in 20 hours.`);

  await interaction.reply({ embeds: [embed] });
}
