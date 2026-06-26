import { SlashCommandBuilder } from 'discord.js';
import { inventoryScreen } from '../lib/actions.js';

export const data = new SlashCommandBuilder()
  .setName('inventory')
  .setDescription('View your skins, total value, and balance');

export async function execute(interaction) {
  const screen = await inventoryScreen(interaction.user.id);
  await interaction.reply(screen);
}
