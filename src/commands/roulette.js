import { SlashCommandBuilder } from 'discord.js';
import { playRoulette } from '../lib/casino.js';
import { MIN_BET, MAX_BET } from '../lib/betting.js';
import { getOrCreateUser } from '../lib/db.js';
import { playSlashResult } from '../lib/ephemeral.js';

export const data = new SlashCommandBuilder()
  .setName('roulette')
  .setDescription('Bet on the roulette wheel')
  .addIntegerOption((o) =>
    o.setName('bet').setDescription('Coins to bet').setRequired(true)
      .setMinValue(MIN_BET).setMaxValue(MAX_BET))
  .addStringOption((o) =>
    o.setName('space').setDescription('red, black, even, odd, or a number 0-36').setRequired(true));

export async function execute(interaction) {
  const bet = interaction.options.getInteger('bet');
  const space = interaction.options.getString('space');
  const user = await getOrCreateUser(interaction.user.id);
  const res = await playRoulette(interaction.user.id, bet, space);
  await playSlashResult(interaction, res, user.fast_mode);
}
