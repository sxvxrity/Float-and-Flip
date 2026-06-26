import { SlashCommandBuilder } from 'discord.js';
import { leaderboardScreen } from '../lib/actions.js';

export const data = new SlashCommandBuilder()
  .setName('leaderboard')
  .setDescription('Top traders ranked by inventory value or coins')
  .addStringOption((opt) =>
    opt.setName('sort')
      .setDescription('Rank by inventory value (default) or coins')
      .addChoices(
        { name: 'Inventory value', value: 'inventory' },
        { name: 'Coins', value: 'coins' },
      ));

export async function execute(interaction) {
  const sort = interaction.options.getString('sort') ?? 'inventory';
  const screen = await leaderboardScreen(interaction.client, interaction.user.id, sort);
  await interaction.reply(screen);
}
