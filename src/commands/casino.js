import { SlashCommandBuilder } from 'discord.js';
import { casinoScreen } from '../lib/casino.js';

export const data = new SlashCommandBuilder()
  .setName('casino')
  .setDescription('Open the casino');

export async function execute(interaction) {
  const screen = await casinoScreen(interaction.user.id);
  await interaction.reply(screen);
}
