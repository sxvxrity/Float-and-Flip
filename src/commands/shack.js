import { SlashCommandBuilder } from 'discord.js';
import { hubScreen } from '../lib/actions.js';

export const data = new SlashCommandBuilder()
  .setName('shack')
  .setDescription('Open your Skin Shack — the button-driven hub');

export async function execute(interaction) {
  const screen = await hubScreen(interaction.user.id);
  await interaction.reply(screen);
}
