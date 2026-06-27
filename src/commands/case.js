import { autoEphemeral } from '../lib/ephemeral.js';
import { SlashCommandBuilder } from 'discord.js';
import { openCase } from '../lib/actions.js';
import { getOrCreateUser } from '../lib/db.js';
import { playSlashResult } from '../lib/ephemeral.js';

export const data = new SlashCommandBuilder()
  .setName('case')
  .setDescription('Open a case and pull a skin');

export async function execute(interaction) {
  const user = await getOrCreateUser(interaction.user.id);
  const res = await openCase(interaction.user.id);
  if (res.error) {
    return autoEphemeral(interaction, res.error);
  }
  // openCase returns { drop, isRare, payload }. Animate the reveal unless fast.
  if (!user.fast_mode) {
    await interaction.reply({
      embeds: [{ color: 0x95a5a6, title: '🎁 Opening case…', description: '`⬜ 🟦 🟪 🟥 🟨`' }],
    });
    await new Promise((r) => setTimeout(r, 1200));
    if (res.isRare) {
      interaction.channel?.send(`🎉 ${interaction.user} just unboxed a **${res.drop.rarity}**!`).catch(() => {});
    }
    return interaction.editReply(res.payload);
  }
  if (res.isRare) {
    interaction.channel?.send(`🎉 ${interaction.user} just unboxed a **${res.drop.rarity}**!`).catch(() => {});
  }
  return interaction.reply(res.payload);
}
