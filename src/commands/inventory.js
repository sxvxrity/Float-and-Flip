import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import { pool, getOrCreateUser } from '../lib/db.js';
import { RARITY_EMOJI, wearBar } from '../lib/visuals.js';
import { skinValue } from '../lib/skins.js';

export const data = new SlashCommandBuilder()
  .setName('inventory')
  .setDescription('View your skins, total value, and balance');

export async function execute(interaction) {
  const user = await getOrCreateUser(interaction.user.id);

  const { rows } = await pool.query(
    `SELECT id, name, rarity, wear, stattrak, value
     FROM inventory WHERE user_id = $1
     ORDER BY value DESC`,
    [user.user_id]
  );

  // Recompute each skin's value live so totals reflect CURRENT rates, not
  // the frozen drop-time price. Re-sort by live value since stored order
  // may be stale after a rebalance.
  const priced = rows
    .map((r) => ({ ...r, live: skinValue({ rarity: r.rarity, wear: r.wear, stattrak: r.stattrak }) }))
    .sort((a, b) => b.live - a.live);

  const totalValue = priced.reduce((a, r) => a + r.live, 0);

  const header =
    `💰 **${user.coins.toLocaleString()}** coins\n` +
    `📦 **${priced.length}/${user.storage_cap}** slots · ` +
    `total value **${totalValue.toLocaleString()}**`;

  const embed = new EmbedBuilder()
    .setColor(0x4b69ff)
    .setTitle(`${interaction.user.username}'s Inventory`);

  if (priced.length === 0) {
    embed.setDescription(`${header}\n\nEmpty — open a case with \`/case\`.`);
  } else {
    // Put the list in the DESCRIPTION (4096-char limit), not a field
    // (1024-char limit), so 10 long skin names can't overflow and make
    // Discord reject the whole message. Names are also truncated defensively.
    const lines = priced.slice(0, 10).map((r) => {
      const emoji = RARITY_EMOJI[r.rarity] ?? '▫️';
      const name = r.name.length > 42 ? r.name.slice(0, 39) + '…' : r.name;
      return `${emoji} \`#${r.id}\` ${r.stattrak ? 'ST™ ' : ''}**${name}** ` +
        `\`${wearBar(r.wear)}\` — ${r.live.toLocaleString()}`;
    });
    const more = priced.length > 10 ? `\n*…and ${priced.length - 10} more*` : '';
    embed.setDescription(`${header}\n\n${lines.join('\n')}${more}`);
  }

  await interaction.reply({ embeds: [embed] });
}
