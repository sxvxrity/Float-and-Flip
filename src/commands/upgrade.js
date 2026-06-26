import { SlashCommandBuilder } from 'discord.js';
import { upgradeScreen } from '../lib/actions.js';

export const data = new SlashCommandBuilder()
  .setName('upgrade')
  .setDescription('View and buy upgrades');

export async function execute(interaction) {
  const screen = await upgradeScreen(interaction.user.id);
  await interaction.reply(screen);
}
