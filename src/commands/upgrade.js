import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import { pool, getOrCreateUser } from '../lib/db.js';
import { COINS_PER_BOT_PER_HOUR, calcPassive } from '../lib/passive.js';

// Scaling cost: each purchase gets more expensive based on how many you own.
const TRADEBOT_BASE = 2000;   // cost = base * (owned + 1)
const STORAGE_STEP = 25;      // slots added per purchase
const STORAGE_BASE = 1500;    // cost = base * (purchases so far + 1)
const FEE_MIN = 3;            // can't go below 3%
const FEE_COST = 5000;        // per 1% reduction

export const data = new SlashCommandBuilder()
  .setName('upgrade')
  .setDescription('Spend coins to grow your operation')
  .addSubcommand((s) =>
    s.setName('tradebot').setDescription(`Buy a trade bot (+${COINS_PER_BOT_PER_HOUR} coins/hour passive)`))
  .addSubcommand((s) =>
    s.setName('storage').setDescription(`Add ${STORAGE_STEP} inventory slots`))
  .addSubcommand((s) =>
    s.setName('fee').setDescription('Reduce your market sell fee by 1%'))
  .addSubcommand((s) =>
    s.setName('list').setDescription('See upgrade costs and your current stats'));

export async function execute(interaction) {
  const user = await getOrCreateUser(interaction.user.id);
  const sub = interaction.options.getSubcommand();

  if (sub === 'list') {
    const botCost = TRADEBOT_BASE * (user.trade_bots + 1);
    const storagePurchases = Math.round((user.storage_cap - 50) / STORAGE_STEP);
    const storageCost = STORAGE_BASE * (storagePurchases + 1);
    const embed = new EmbedBuilder()
      .setColor(0x4b69ff)
      .setTitle('Upgrades')
      .setDescription(`💰 You have **${user.coins.toLocaleString()}** coins`)
      .addFields(
        { name: `🤖 Trade bot — ${botCost.toLocaleString()}`,
          value: `Owned: ${user.trade_bots} · earns ${(user.trade_bots * COINS_PER_BOT_PER_HOUR).toLocaleString()}/h total` },
        { name: `📦 Storage +${STORAGE_STEP} — ${storageCost.toLocaleString()}`,
          value: `Current cap: ${user.storage_cap}` },
        { name: `🏷️ Fee −1% — ${FEE_COST.toLocaleString()}`,
          value: user.sell_fee <= FEE_MIN ? `At minimum (${FEE_MIN}%)` : `Current: ${user.sell_fee}%` },
      );
    return interaction.reply({ embeds: [embed] });
  }

  if (sub === 'tradebot') {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      // Lock + re-read the row so cost is based on CURRENT bot count, not a
      // stale value. Prevents parallel buys all paying the cheapest tier price.
      const { rows: [u] } = await client.query(
        'SELECT * FROM users WHERE user_id = $1 FOR UPDATE', [user.user_id]);
      const cost = TRADEBOT_BASE * (u.trade_bots + 1);
      if (u.coins < cost) {
        await client.query('ROLLBACK');
        return notEnough(interaction, cost, u.coins);
      }
      const { earned } = calcPassive(u); // collect pending so new bot doesn't backdate
      await client.query(
        `UPDATE users SET coins = coins - $1 + $2, trade_bots = trade_bots + 1,
         last_passive = NOW() WHERE user_id = $3`,
        [cost, earned, user.user_id]
      );
      await client.query('COMMIT');
      return interaction.reply(
        `🤖 Bought trade bot #${u.trade_bots + 1} for **${cost.toLocaleString()}**.` +
        (earned > 0 ? ` (Auto-collected ${earned.toLocaleString()} pending coins.)` : '') +
        ` Use \`/invest\` to collect earnings.`
      );
    } catch (e) {
      await client.query('ROLLBACK'); throw e;
    } finally {
      client.release();
    }
  }

  if (sub === 'storage') {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const { rows: [u] } = await client.query(
        'SELECT * FROM users WHERE user_id = $1 FOR UPDATE', [user.user_id]);
      const purchases = Math.round((u.storage_cap - 50) / STORAGE_STEP);
      const cost = STORAGE_BASE * (purchases + 1);
      if (u.coins < cost) {
        await client.query('ROLLBACK');
        return notEnough(interaction, cost, u.coins);
      }
      await client.query(
        'UPDATE users SET coins = coins - $1, storage_cap = storage_cap + $2 WHERE user_id = $3',
        [cost, STORAGE_STEP, user.user_id]
      );
      await client.query('COMMIT');
      return interaction.reply(
        `📦 Storage expanded to **${u.storage_cap + STORAGE_STEP}** slots for **${cost.toLocaleString()}**.`
      );
    } catch (e) {
      await client.query('ROLLBACK'); throw e;
    } finally {
      client.release();
    }
  }

  if (sub === 'fee') {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const { rows: [u] } = await client.query(
        'SELECT * FROM users WHERE user_id = $1 FOR UPDATE', [user.user_id]);
      if (u.sell_fee <= FEE_MIN) {
        await client.query('ROLLBACK');
        return interaction.reply({ content: `Your fee is already at the minimum (${FEE_MIN}%).`, ephemeral: true });
      }
      if (u.coins < FEE_COST) {
        await client.query('ROLLBACK');
        return notEnough(interaction, FEE_COST, u.coins);
      }
      await client.query(
        'UPDATE users SET coins = coins - $1, sell_fee = sell_fee - 1 WHERE user_id = $2',
        [FEE_COST, user.user_id]
      );
      await client.query('COMMIT');
      return interaction.reply(
        `🏷️ Sell fee reduced to **${u.sell_fee - 1}%** for **${FEE_COST.toLocaleString()}**.`
      );
    } catch (e) {
      await client.query('ROLLBACK'); throw e;
    } finally {
      client.release();
    }
  }
}

function notEnough(interaction, cost, have) {
  return interaction.reply({
    content: `That costs ${cost.toLocaleString()} coins. You have ${have.toLocaleString()}.`,
    ephemeral: true,
  });
}
