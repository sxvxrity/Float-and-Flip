import { autoEphemeral } from '../lib/ephemeral.js';
import { SlashCommandBuilder, MessageFlags } from 'discord.js';
import { pool, getOrCreateUser } from '../lib/db.js';
import { skinValue } from '../lib/skins.js';

export const data = new SlashCommandBuilder()
  .setName('sell')
  .setDescription('Sell a skin from your inventory')
  .addIntegerOption((opt) =>
    opt.setName('id')
      .setDescription('The inventory ID of the skin (see /inventory)')
      .setRequired(true)
      .setMinValue(1)
  );

export async function execute(interaction) {
  const user = await getOrCreateUser(interaction.user.id);
  const id = interaction.options.getInteger('id');

  const client = await pool.connect();
  let sold = null;
  try {
    await client.query('BEGIN');

    // DELETE ... RETURNING is the gate: it atomically removes the row AND
    // tells us its data. If two /sell calls race, only ONE deletes a row —
    // the other gets zero rows back and pays nothing. No double-sell.
    const { rows } = await client.query(
      'DELETE FROM inventory WHERE id = $1 AND user_id = $2 RETURNING *',
      [id, user.user_id]
    );
    const item = rows[0];

    if (!item) {
      await client.query('ROLLBACK');
      return autoEphemeral(interaction, `No skin with ID #${id} in your inventory.`);
    }

    // Compute value LIVE from the skin's properties and current rates —
    // NOT from item.value (the frozen drop-time price). This means a rebalance
    // of RARITIES or ECONOMY_MULT instantly re-prices every skin in the game.
    const liveValue = skinValue({ rarity: item.rarity, wear: item.wear, stattrak: item.stattrak });
    const drift = 0.85 + Math.random() * 0.3;        // ±15% market drift
    const market = Math.round(liveValue * drift);
    const fee = Math.round(market * (user.sell_fee / 100));
    const payout = market - fee;

    await client.query(
      'UPDATE users SET coins = coins + $1 WHERE user_id = $2',
      [payout, user.user_id]
    );
    await client.query('COMMIT');

    sold = { item, market, fee, payout };
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }

  await interaction.reply(
    `Sold **${sold.item.stattrak ? 'StatTrak™ ' : ''}${sold.item.name}** ` +
    `(${sold.item.wear}) for **${sold.market.toLocaleString()}** ` +
    `(− ${sold.fee.toLocaleString()} fee) → **+${sold.payout.toLocaleString()}** coins.`
  );
}
