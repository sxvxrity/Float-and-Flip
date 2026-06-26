import { SlashCommandBuilder } from 'discord.js';
import { playCoinflip } from '../lib/casino.js';
import { MIN_BET, MAX_BET } from '../lib/betting.js';
import { getOrCreateUser } from '../lib/db.js';
import { playSlashResult } from '../lib/ephemeral.js';

export const data = new SlashCommandBuilder()
  .setName('coinflip')
  .setDescription('Flip a coin, double-or-nothing-ish')
  .addIntegerOption((o) =>
    o.setName('bet').setDescription('Coins to bet').setRequired(true)
      .setMinValue(MIN_BET).setMaxValue(MAX_BET))
  .addStringOption((o) =>
    o.setName('side').setDescription('heads or tails').setRequired(true)
      .addChoices({ name: 'Heads', value: 'heads' }, { name: 'Tails', value: 'tails' }));

export async function execute(interaction) {
  const bet = interaction.options.getInteger('bet');
  const side = interaction.options.getString('side');
  const user = await getOrCreateUser(interaction.user.id);
  const res = await playCoinflip(interaction.user.id, bet, side);
  await playSlashResult(interaction, res, user.fast_mode);
}
