import { SlashCommandBuilder, EmbedBuilder, MessageFlags } from 'discord.js';
import { pool, getOrCreateUser } from '../lib/db.js';
import { RARITY_EMOJI, wearBar, color } from '../lib/visuals.js';
import { skinValue } from '../lib/skins.js';
import { marketScreen } from '../lib/actions.js';

const PAGE_SIZE = 10;
const MARKET_FEE = 5; // percent taken from the seller on a sale
const MIN_LISTING_PRICE = 10; // stops 1-coin alt-account transfers being friction-free

// Auto-buy floor: if no player buys a listing within a randomized window,
// the system buys it at a discount so the market always has liquidity.
const EXPIRY_MIN_HOURS = 2;
const EXPIRY_MAX_HOURS = 12;

export const data = new SlashCommandBuilder()
  .setName('market')
  .setDescription('Buy and sell skins with other players')
  .addSubcommand((s) =>
    s.setName('browse').setDescription('Browse skins for sale')
      .addIntegerOption((o) => o.setName('page').setDescription('Page number')))
  .addSubcommand((s) =>
    s.setName('list').setDescription('List one of your skins for sale')
      .addIntegerOption((o) => o.setName('id').setDescription('Inventory ID (see /inventory)').setRequired(true).setMinValue(1))
      .addIntegerOption((o) => o.setName('price').setDescription('Asking price in coins').setRequired(true).setMinValue(10).setMaxValue(100_000_000)))
  .addSubcommand((s) =>
    s.setName('buy').setDescription('Buy a listed skin')
      .addIntegerOption((o) => o.setName('listing').setDescription('Listing ID (see /market browse)').setRequired(true).setMinValue(1)))
  .addSubcommand((s) =>
    s.setName('unlist').setDescription('Remove your listing and return the skin to your inventory')
      .addIntegerOption((o) => o.setName('listing').setDescription('Listing ID').setRequired(true).setMinValue(1)));

export async function execute(interaction) {
  const user = await getOrCreateUser(interaction.user.id);
  const sub = interaction.options.getSubcommand();

  if (sub === 'browse')  return browse(interaction);
  if (sub === 'list')    return list(interaction, user);
  if (sub === 'buy')     return buy(interaction, user);
  if (sub === 'unlist')  return unlist(interaction, user);
}

async function browse(interaction) {
  const page = Math.max(1, interaction.options.getInteger('page') ?? 1);
  // Use the shared button-driven market screen (Buy buttons + pagination).
  const screen = await marketScreen(interaction.user.id, page);
  return interaction.reply(screen);
}

async function list(interaction, user) {
  const id = interaction.options.getInteger('id');
  const price = interaction.options.getInteger('price');
  if (price < MIN_LISTING_PRICE) {
    return interaction.reply({
      content: `Minimum listing price is ${MIN_LISTING_PRICE} coins.`,
      flags: MessageFlags.Ephemeral,
    });
  }

  // Move the skin out of inventory and into listings, atomically.
  // The DELETE ... RETURNING is the gate: if the skin was just sold or listed
  // by a concurrent command, no row comes back and we abort instead of
  // creating a listing for a skin the user no longer owns.
  const client = await pool.connect();
  let listingId, item;
  try {
    await client.query('BEGIN');
    const del = await client.query(
      'DELETE FROM inventory WHERE id = $1 AND user_id = $2 RETURNING *',
      [id, user.user_id]
    );
    item = del.rows[0];
    if (!item) {
      await client.query('ROLLBACK');
      return interaction.reply({ content: `No skin with ID #${id} in your inventory.`, flags: MessageFlags.Ephemeral });
    }

    // Capture the skin's intrinsic value LIVE (current rates), not its frozen
    // item.value — so the auto-buy floor pays correctly even after a rebalance.
    const baseValue = skinValue({ rarity: item.rarity, wear: item.wear, stattrak: item.stattrak });

    // Each listing expires after its own randomized window, so the auto-buy
    // floor doesn't sweep everything at once.
    const expiryHours = EXPIRY_MIN_HOURS + Math.random() * (EXPIRY_MAX_HOURS - EXPIRY_MIN_HOURS);
    const res = await client.query(
      `INSERT INTO market_listings (seller_id, skin_id, name, rarity, wear, stattrak, price, base_value, image, expires_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9, NOW() + ($10 || ' hours')::interval) RETURNING listing_id`,
      [user.user_id, item.skin_id, item.name, item.rarity, item.wear, item.stattrak, price, baseValue, item.image, expiryHours.toFixed(2)]
    );
    listingId = res.rows[0].listing_id;
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }

  await interaction.reply(
    `🏷️ Listed **${item.stattrak ? 'StatTrak™ ' : ''}${item.name}** for ` +
    `**${price.toLocaleString()}** coins (listing \`#${listingId}\`).`
  );
}

async function buy(interaction, user) {
  const listingId = interaction.options.getInteger('listing');

  await interaction.deferReply();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Lock the row so two buyers can't grab the same listing.
    const { rows } = await client.query(
      'SELECT * FROM market_listings WHERE listing_id = $1 FOR UPDATE',
      [listingId]
    );
    const lst = rows[0];
    if (!lst) {
      await client.query('ROLLBACK');
      return interaction.editReply(`Listing #${listingId} no longer exists.`);
    }
    if (lst.seller_id === user.user_id) {
      await client.query('ROLLBACK');
      return interaction.editReply('You can\'t buy your own listing. Use `/market unlist` instead.');
    }

    // Re-read buyer balance inside the transaction, locking the buyer's row
    // (FOR UPDATE) so a concurrent purchase on another listing can't also pass
    // this balance check and let the user overspend across both.
    const { rows: [buyer] } = await client.query(
      'SELECT coins, storage_cap FROM users WHERE user_id = $1 FOR UPDATE', [user.user_id]
    );
    if (buyer.coins < lst.price) {
      await client.query('ROLLBACK');
      return interaction.editReply(
        `You need ${Number(lst.price).toLocaleString()} coins. You have ${Number(buyer.coins).toLocaleString()}.`
      );
    }

    const { rows: [{ count }] } = await client.query(
      'SELECT COUNT(*) FROM inventory WHERE user_id = $1', [user.user_id]
    );
    if (Number(count) >= buyer.storage_cap) {
      await client.query('ROLLBACK');
      return interaction.editReply(`Your storage is full (${count}/${buyer.storage_cap}). Free up space first.`);
    }

    const fee = Math.round(Number(lst.price) * (MARKET_FEE / 100));
    const payout = Number(lst.price) - fee;

    // Move coins, give buyer the skin, pay the seller, delete the listing.
    // The bought skin enters inventory at its INTRINSIC value (base_value),
    // NOT the price paid. Otherwise an alt could list at 1M, you buy it, and
    // /sell pays ~85% of 1M from the system — minting coins from nothing.
    await client.query('UPDATE users SET coins = coins - $1 WHERE user_id = $2', [lst.price, user.user_id]);
    await client.query('UPDATE users SET coins = coins + $1 WHERE user_id = $2', [payout, lst.seller_id]);
    await client.query(
      `INSERT INTO inventory (user_id, skin_id, name, rarity, wear, stattrak, value, image)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [user.user_id, lst.skin_id, lst.name, lst.rarity, lst.wear, lst.stattrak, lst.base_value, lst.image]
    );
    await client.query('DELETE FROM market_listings WHERE listing_id = $1', [listingId]);
    await client.query('COMMIT');

    const emoji = RARITY_EMOJI[lst.rarity] ?? '▫️';
    const embed = new EmbedBuilder()
      .setColor(color(lst.rarity))
      .setTitle(`${emoji} ${lst.stattrak ? 'StatTrak™ ' : ''}${lst.name}`)
      .setDescription(`Purchased for **${Number(lst.price).toLocaleString()}** coins\n${lst.wear}  \`${wearBar(lst.wear)}\``)
      .setThumbnail(lst.image || null);
    return interaction.editReply({ embeds: [embed] });
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

async function unlist(interaction, user) {
  const listingId = interaction.options.getInteger('listing');

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      'SELECT * FROM market_listings WHERE listing_id = $1 AND seller_id = $2 FOR UPDATE',
      [listingId, user.user_id]
    );
    const lst = rows[0];
    if (!lst) {
      await client.query('ROLLBACK');
      return interaction.reply({ content: `You have no listing with ID #${listingId}.`, flags: MessageFlags.Ephemeral });
    }
    // Return the skin at its intrinsic value, not the asking price — same
    // reason as buy: stops list-high-then-unlist inflating a skin's value.
    await client.query(
      `INSERT INTO inventory (user_id, skin_id, name, rarity, wear, stattrak, value, image)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [user.user_id, lst.skin_id, lst.name, lst.rarity, lst.wear, lst.stattrak, lst.base_value, lst.image]
    );
    await client.query('DELETE FROM market_listings WHERE listing_id = $1', [listingId]);
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }

  await interaction.reply(`↩️ Listing #${listingId} removed — skin returned to your inventory.`);
}
