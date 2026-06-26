import { SlashCommandBuilder } from 'discord.js';
import { hubScreen } from '../lib/actions.js';

export const data = new SlashCommandBuilder()
  .setName('hub')
  .setDescription('Open your Skin Hub — the button-driven menu');

export async function execute(interaction) {
  const screen = await hubScreen(interaction.user.id);
  await interaction.reply(screen);
}
