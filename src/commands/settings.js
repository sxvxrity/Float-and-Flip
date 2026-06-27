import { autoEphemeral } from '../lib/ephemeral.js';
import { SlashCommandBuilder, MessageFlags } from 'discord.js';
import { pool, getOrCreateUser } from '../lib/db.js';

export const data = new SlashCommandBuilder()
  .setName('settings')
  .setDescription('Your personal preferences')
  .addSubcommand((s) =>
    s.setName('fastmode')
      .setDescription('Skip the case-opening animation for instant results')
      .addBooleanOption((o) =>
        o.setName('enabled').setDescription('Turn fast mode on or off').setRequired(true)));

export async function execute(interaction) {
  const user = await getOrCreateUser(interaction.user.id);
  const sub = interaction.options.getSubcommand();

  if (sub === 'fastmode') {
    const enabled = interaction.options.getBoolean('enabled');
    await pool.query(
      'UPDATE users SET fast_mode = $1 WHERE user_id = $2',
      [enabled, user.user_id]
    );
    return autoEphemeral(interaction,
      enabled
        ? '⚡ Fast mode **on** — `/case` now skips the reveal animation.'
        : '🎁 Fast mode **off** — case openings will play the full reveal.');
  }
}
