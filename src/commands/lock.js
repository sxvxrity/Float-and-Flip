import { SlashCommandBuilder } from 'discord.js';
import { toggleLock } from '../lib/actions.js';
import { autoEphemeral } from '../lib/ephemeral.js';

export const data = new SlashCommandBuilder()
  .setName('lock')
  .setDescription('Lock or unlock a skin to protect it from Sell All')
  .addIntegerOption((o) =>
    o.setName('id').setDescription('Skin ID from your inventory').setRequired(true));

export async function execute(interaction) {
  const id = interaction.options.getInteger('id');
  const res = await toggleLock(interaction.user.id, id);
  if (res.error) return autoEphemeral(interaction, res.error);
  return autoEphemeral(interaction,
    res.locked
      ? `🔒 **${res.name}** locked — Sell All will skip it.`
      : `🔓 **${res.name}** unlocked — it will be included in Sell All.`);
}
