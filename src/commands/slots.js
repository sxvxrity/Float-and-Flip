import { SlashCommandBuilder } from 'discord.js';
import { playSlots } from '../lib/casino.js';
import { MIN_BET, MAX_BET } from '../lib/betting.js';
import { getOrCreateUser } from '../lib/db.js';
import { playSlashResult } from '../lib/ephemeral.js';

export const data = new SlashCommandBuilder()
  .setName('slots')
  .setDescription('Spin the slot machine')
  .addIntegerOption((o) =>
    o.setName('bet').setDescription('Coins to bet').setRequired(true)
      .setMinValue(MIN_BET).setMaxValue(MAX_BET));

export async function execute(interaction) {
  const bet = interaction.options.getInteger('bet');
  const user = await getOrCreateUser(interaction.user.id);
  const res = await playSlots(interaction.user.id, bet);
  await playSlashResult(interaction, res, user.fast_mode);
}
