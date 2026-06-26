import { SlashCommandBuilder, MessageFlags } from 'discord.js';
import { startBlackjack } from '../lib/casino.js';
import { MIN_BET, MAX_BET } from '../lib/betting.js';

export const data = new SlashCommandBuilder()
  .setName('blackjack')
  .setDescription('Play a hand of blackjack against the dealer')
  .addIntegerOption((o) =>
    o.setName('bet').setDescription('Coins to bet').setRequired(true)
      .setMinValue(MIN_BET).setMaxValue(MAX_BET));

export async function execute(interaction) {
  const bet = interaction.options.getInteger('bet');
  const res = await startBlackjack(interaction.user.id, bet);
  if (res.error) return interaction.reply({ content: res.error, flags: MessageFlags.Ephemeral });
  await interaction.reply(res.payload);
}
