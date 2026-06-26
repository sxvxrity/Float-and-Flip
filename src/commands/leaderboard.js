import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import { pool, getOrCreateUser } from '../lib/db.js';
import { valueSqlExpression } from '../lib/skins.js';

const TOP_N = 10;

export const data = new SlashCommandBuilder()
  .setName('leaderboard')
  .setDescription('Top traders ranked by total inventory value')
  .addStringOption((opt) =>
    opt.setName('sort')
      .setDescription('Rank by inventory value (default) or coins')
      .addChoices(
        { name: 'Inventory value', value: 'inventory' },
        { name: 'Coins', value: 'coins' },
      )
  );

export async function execute(interaction) {
  await getOrCreateUser(interaction.user.id); // ensure caller is in the table
  const sort = interaction.options.getString('sort') ?? 'inventory';

  // Rank every user. Inventory value is summed LIVE from current rates via
  // valueSqlExpression() — not the frozen stored value — so a rebalance
  // re-ranks everyone correctly. Window function keeps ranks right past top N.
  const metric = sort === 'coins' ? 'u.coins' : 'COALESCE(inv.total, 0)';
  const { rows } = await pool.query(`
    WITH inv AS (
      SELECT user_id, SUM(${valueSqlExpression()}) AS total
      FROM inventory GROUP BY user_id
    ),
    ranked AS (
      SELECT u.user_id,
             u.coins,
             COALESCE(inv.total, 0) AS inv_value,
             RANK() OVER (ORDER BY ${metric} DESC) AS rank
      FROM users u
      LEFT JOIN inv ON inv.user_id = u.user_id
    )
    SELECT * FROM ranked ORDER BY rank ASC
  `);

  if (rows.length === 0) {
    return interaction.reply('No traders yet. Be the first with `/case`.');
  }

  const medals = ['🥇', '🥈', '🥉'];
  const fmt = (r) =>
    sort === 'coins'
      ? `${Number(r.coins).toLocaleString()} coins`
      : `${Number(r.inv_value).toLocaleString()} value`;

  // Resolve display names for the top N (fetch can fail for users who left).
  const top = rows.slice(0, TOP_N);
  const lines = await Promise.all(top.map(async (r, i) => {
    let name = `User ${r.user_id.slice(0, 6)}`;
    try {
      const u = await interaction.client.users.fetch(r.user_id);
      name = u.username;
    } catch { /* user not reachable, keep fallback */ }
    const badge = medals[i] ?? `**${i + 1}.**`;
    return `${badge} ${name} — ${fmt(r)}`;
  }));

  const embed = new EmbedBuilder()
    .setColor(0xf1c40f)
    .setTitle(`Leaderboard — ${sort === 'coins' ? 'Coins' : 'Inventory Value'}`)
    .setDescription(lines.join('\n'));

  // If the caller isn't in the visible top N, append their own standing.
  const me = rows.find((r) => r.user_id === interaction.user.id);
  if (me && me.rank > TOP_N) {
    embed.addFields({
      name: 'Your rank',
      value: `**#${me.rank}** of ${rows.length} — ${fmt(me)}`,
    });
  }

  await interaction.reply({ embeds: [embed] });
}
