import { SlashCommandBuilder } from 'discord.js';
import { playMatch } from '../lib/match.js';
import { getOrCreateUser } from '../lib/db.js';
import { playSlashResult } from '../lib/ephemeral.js';

export const data = new SlashCommandBuilder()
  .setName('match')
  .setDescription('Play a CS2 match — win coins and maybe a skin, or lose');

export async function execute(interaction) {
  const user = await getOrCreateUser(interaction.user.id);
  const res = await playMatch(interaction.user.id);
  await playSlashResult(interaction, res, user.fast_mode);
}
