// The "actions" layer. Each function performs a game action and/or builds a
// screen (embed + buttons), taking only a userId and args — it doesn't care
// whether a slash command or a button triggered it. Slash commands and the
// button handler both call these, so game logic lives in exactly one place.

import { EmbedBuilder, ButtonStyle } from 'discord.js';
import { pool, getOrCreateUser } from './db.js';
import { rollSkin, skinValue } from './skins.js';
import { calcPassive, COINS_PER_BOT_PER_HOUR } from './passive.js';
import { RARITY_EMOJI, wearBar, color } from './visuals.js';
import { navRow, earnRow, playRow, row, sellButton, buyButton, marketNav, Btn } from './components.js';

const b = Btn.b; // button builder shorthand

const CASE_COST = 250;
const PAGE_SIZE = 5;          // smaller pages so each can carry a Buy button row
const MARKET_FEE = 5;

// ── HUB ─────────────────────────────────────────────────────────────
// The main "Shack" screen: balance, bots, quick stats, and the action bar.
export async function hubScreen(userId) {
  const user = await getOrCreateUser(userId);
  const { rows: [{ count }] } = await pool.query(
    'SELECT COUNT(*) FROM inventory WHERE user_id = $1', [userId]);
  const { earned } = calcPassive(user);

  const embed = new EmbedBuilder()
    .setColor(0x4b69ff)
    .setTitle('🏠 Your Skin Shack')
    .setDescription(
      `💰 **${user.coins.toLocaleString()}** coins\n` +
      `🎒 **${count}/${user.storage_cap}** skins\n` +
      `🤖 **${user.trade_bots}** trade bot(s)` +
      (earned > 0 ? ` · **${earned.toLocaleString()}** ready to collect` : '')
    )
    .setFooter({ text: 'Open cases, collect income, climb the leaderboard' });

  return { embeds: [embed], components: [earnRow(), playRow(), navRow('shack')] };
}

// ── OPEN CASE ───────────────────────────────────────────────────────
// Returns { result, animate } — animate is true when the caller should play
// the reveal (slash command does; buttons jump straight to result for speed).
export async function openCase(userId) {
  const user = await getOrCreateUser(userId);
  if (user.coins < CASE_COST) {
    return { error: `You need ${CASE_COST} coins. You have ${user.coins.toLocaleString()}.` };
  }

  const drop = await rollSkin();
  const client = await pool.connect();
  let outcome = 'ok';
  try {
    await client.query('BEGIN');
    const pay = await client.query(
      'UPDATE users SET coins = coins - $1 WHERE user_id = $2 AND coins >= $1',
      [CASE_COST, userId]);
    if (pay.rowCount === 0) { await client.query('ROLLBACK'); outcome = 'broke'; }
    else {
      const ins = await client.query(
        `INSERT INTO inventory (user_id, skin_id, name, rarity, wear, stattrak, value, image)
         SELECT $1,$2,$3,$4,$5,$6,$7,$8
         WHERE (SELECT COUNT(*) FROM inventory WHERE user_id = $1) < $9`,
        [userId, drop.skin_id, drop.name, drop.rarity, drop.wear, drop.stattrak, drop.value, drop.image, user.storage_cap]);
      if (ins.rowCount === 0) { await client.query('ROLLBACK'); outcome = 'full'; }
      else await client.query('COMMIT');
    }
  } catch (e) { await client.query('ROLLBACK'); throw e; }
  finally { client.release(); }

  if (outcome === 'broke') return { error: `You no longer have ${CASE_COST} coins.` };
  if (outcome === 'full') return { error: `Storage full (${user.storage_cap}/${user.storage_cap}). Sell or upgrade.` };

  const emoji = RARITY_EMOJI[drop.rarity] ?? '▫️';
  const embed = new EmbedBuilder()
    .setColor(color(drop.rarity))
    .setTitle(`${emoji} ${drop.stattrak ? 'StatTrak™ ' : ''}${drop.name}`)
    .setDescription(`**${drop.rarity}**\n${drop.wear}  \`${wearBar(drop.wear)}\``)
    .addFields({ name: 'Value', value: `${drop.value.toLocaleString()} coins`, inline: true })
    .setThumbnail(drop.image || null);

  const isRare = ['Covert', 'Extraordinary'].includes(drop.rarity);
  return {
    drop, isRare,
    payload: { embeds: [embed], components: [earnRow(), navRow()] },
  };
}

// ── DAILY ───────────────────────────────────────────────────────────
export async function claimDaily(userId) {
  const DAILY_BASE = 500, COOLDOWN_MS = 20 * 3_600_000;
  const user = await getOrCreateUser(userId);
  const total = DAILY_BASE + Math.floor(Math.random() * 300);
  const cutoff = new Date(Date.now() - COOLDOWN_MS).toISOString();
  const res = await pool.query(
    `UPDATE users SET coins = coins + $1, last_daily = NOW()
     WHERE user_id = $2 AND (last_daily IS NULL OR last_daily <= $3)`,
    [total, userId, cutoff]);

  if (res.rowCount === 0) {
    const elapsed = Date.now() - new Date(user.last_daily).getTime();
    const rem = Math.max(0, COOLDOWN_MS - elapsed);
    const h = Math.floor(rem / 3_600_000), m = Math.floor((rem % 3_600_000) / 60_000);
    return { error: `Already claimed. Come back in ${h}h ${m}m.` };
  }
  const embed = new EmbedBuilder().setColor(0xf1c40f).setTitle('Daily claimed')
    .setDescription(`💰 **+${total.toLocaleString()}** coins\nCome back in 20 hours.`);
  return { payload: { embeds: [embed], components: [earnRow(), navRow()] } };
}

// ── COLLECT (invest) ────────────────────────────────────────────────
export async function collectIncome(userId) {
  const user = await getOrCreateUser(userId);
  if (user.trade_bots <= 0) return { error: 'No trade bots yet. Buy one with `/upgrade tradebot`.' };
  const { earned, hours } = calcPassive(user);
  if (earned <= 0) return { error: 'Nothing to collect yet — check back soon.' };

  const res = await pool.query(
    `UPDATE users SET coins = coins + $1, last_passive = NOW()
     WHERE user_id = $2 AND last_passive = $3`,
    [earned, userId, new Date(user.last_passive).toISOString()]);
  if (res.rowCount === 0) return { error: 'Those earnings were just collected.' };

  const rate = user.trade_bots * COINS_PER_BOT_PER_HOUR;
  const embed = new EmbedBuilder().setColor(0x2ecc71).setTitle('Trade bots collected')
    .setDescription(`🤖 **${user.trade_bots}** bot(s) · **${hours.toFixed(1)}h**\n` +
      `Earned **+${earned.toLocaleString()}** coins\nRate: ${rate.toLocaleString()}/hour`);
  return { payload: { embeds: [embed], components: [earnRow(), navRow()] } };
}

// ── INVENTORY ───────────────────────────────────────────────────────
// Shows up to 5 skins, each with its own Sell button row.
export async function inventoryScreen(userId) {
  const user = await getOrCreateUser(userId);
  const { rows } = await pool.query(
    'SELECT id, name, rarity, wear, stattrak FROM inventory WHERE user_id = $1', [userId]);

  const priced = rows
    .map((r) => ({ ...r, live: skinValue({ rarity: r.rarity, wear: r.wear, stattrak: r.stattrak }) }))
    .sort((a, b) => b.live - a.live);
  const total = priced.reduce((a, r) => a + r.live, 0);

  const embed = new EmbedBuilder().setColor(0x4b69ff)
    .setTitle('🎒 Your Inventory')
    .setDescription(
      `💰 **${user.coins.toLocaleString()}** coins · ` +
      `📦 **${priced.length}/${user.storage_cap}** · total **${total.toLocaleString()}**`);

  const components = [];
  if (priced.length === 0) {
    embed.addFields({ name: 'Empty', value: 'Open a case to get started.' });
  } else {
    // Top 5 each get a labelled Sell button (one button per row so the
    // label can name the skin — Discord allows max 5 rows per message).
    const top = priced.slice(0, 5);
    embed.setDescription(embed.data.description + '\n\n' + top.map((r) => {
      const e = RARITY_EMOJI[r.rarity] ?? '▫️';
      const name = r.name.length > 32 ? r.name.slice(0, 29) + '…' : r.name;
      return `${e} \`#${r.id}\` ${r.stattrak ? 'ST™ ' : ''}**${name}** \`${wearBar(r.wear)}\` — ${r.live.toLocaleString()}`;
    }).join('\n') + (priced.length > 5 ? `\n*…and ${priced.length - 5} more (use /sell for those)*` : ''));

    // One row of up to 5 sell buttons, labelled by item id.
    const sellRow = row(...top.map((r) => sellButton(r.id).setLabel(`Sell #${r.id}`)));
    components.push(sellRow);
  }
  components.push(navRow('inventory'));
  return { embeds: [embed], components };
}

// ── SELL one item ───────────────────────────────────────────────────
export async function sellItem(userId, itemId) {
  const user = await getOrCreateUser(userId);
  const client = await pool.connect();
  let sold = null;
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      'DELETE FROM inventory WHERE id = $1 AND user_id = $2 RETURNING *', [itemId, userId]);
    const item = rows[0];
    if (!item) { await client.query('ROLLBACK'); return { error: `No skin #${itemId} in your inventory.` }; }
    const live = skinValue({ rarity: item.rarity, wear: item.wear, stattrak: item.stattrak });
    const market = Math.round(live * (0.85 + Math.random() * 0.3));
    const fee = Math.round(market * (user.sell_fee / 100));
    const payout = market - fee;
    await client.query('UPDATE users SET coins = coins + $1 WHERE user_id = $2', [payout, userId]);
    await client.query('COMMIT');
    sold = { item, market, fee, payout };
  } catch (e) { await client.query('ROLLBACK'); throw e; }
  finally { client.release(); }

  return { soldText: `💸 Sold **${sold.item.stattrak ? 'ST™ ' : ''}${sold.item.name}** ` +
    `for **${sold.market.toLocaleString()}** (−${sold.fee.toLocaleString()} fee) → **+${sold.payout.toLocaleString()}** coins.` };
}

// ── MARKET browse ───────────────────────────────────────────────────
export async function marketScreen(userId, page = 1) {
  await getOrCreateUser(userId);
  page = Math.max(1, page);
  const offset = (page - 1) * PAGE_SIZE;
  const { rows: [{ count }] } = await pool.query('SELECT COUNT(*) FROM market_listings');
  const total = Number(count);
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const { rows } = await pool.query(
    'SELECT * FROM market_listings ORDER BY price ASC LIMIT $1 OFFSET $2', [PAGE_SIZE, offset]);

  const embed = new EmbedBuilder().setColor(0x4b69ff).setTitle('🛒 Market — cheapest first');
  const components = [];

  if (rows.length === 0) {
    embed.setDescription(total === 0 ? 'Market is empty. List a skin with `/market list`.' : 'No listings on this page.');
  } else {
    embed.setDescription(rows.map((r) => {
      const e = RARITY_EMOJI[r.rarity] ?? '▫️';
      const name = r.name.length > 32 ? r.name.slice(0, 29) + '…' : r.name;
      return `${e} \`#${r.listing_id}\` ${r.stattrak ? 'ST™ ' : ''}**${name}** \`${wearBar(r.wear)}\` — **${Number(r.price).toLocaleString()}**`;
    }).join('\n')).setFooter({ text: `Page ${page}/${totalPages} · ${total} listings` });
    // A row of Buy buttons, labelled by listing id.
    components.push(row(...rows.map((r) => buyButton(r.listing_id).setLabel(`Buy #${r.listing_id}`))));
  }
  components.push(marketNav(page, totalPages));
  return { embeds: [embed], components };
}

// ── UPGRADES ────────────────────────────────────────────────────────
const TRADEBOT_BASE = 2000, STORAGE_STEP = 25, STORAGE_BASE = 1500;
const FEE_MIN = 3, FEE_COST = 5000;

export async function upgradeScreen(userId) {
  const user = await getOrCreateUser(userId);
  const botCost = TRADEBOT_BASE * (user.trade_bots + 1);
  const storagePurchases = Math.round((user.storage_cap - 50) / STORAGE_STEP);
  const storageCost = STORAGE_BASE * (storagePurchases + 1);

  const embed = new EmbedBuilder().setColor(0x4b69ff)
    .setTitle('🛠️ Upgrades')
    .setDescription(`💰 You have **${user.coins.toLocaleString()}** coins`)
    .addFields(
      { name: `🤖 Trade bot — ${botCost.toLocaleString()}`,
        value: `Owned: ${user.trade_bots} · earns ${(user.trade_bots * COINS_PER_BOT_PER_HOUR).toLocaleString()}/h` },
      { name: `📦 Storage +${STORAGE_STEP} — ${storageCost.toLocaleString()}`,
        value: `Current cap: ${user.storage_cap}` },
      { name: `🏷️ Fee −1% — ${FEE_COST.toLocaleString()}`,
        value: user.sell_fee <= FEE_MIN ? `At minimum (${FEE_MIN}%)` : `Current: ${user.sell_fee}%` },
    );

  const buyRow = row(
    b('upgrade:tradebot', 'Buy Bot', ButtonStyle.Success, '🤖'),
    b('upgrade:storage', 'Buy Storage', ButtonStyle.Success, '📦'),
    user.sell_fee > FEE_MIN ? b('upgrade:fee', 'Lower Fee', ButtonStyle.Success, '🏷️') : null,
  );
  return { embeds: [embed], components: [buyRow, navRow()] };
}

// Performs one upgrade purchase. kind = 'tradebot' | 'storage' | 'fee'.
export async function buyUpgrade(userId, kind) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows: [u] } = await client.query(
      'SELECT * FROM users WHERE user_id = $1 FOR UPDATE', [userId]);

    if (kind === 'tradebot') {
      const cost = TRADEBOT_BASE * (u.trade_bots + 1);
      if (u.coins < cost) { await client.query('ROLLBACK'); return { error: `Need ${cost.toLocaleString()} coins.` }; }
      const { earned } = calcPassive(u);
      await client.query(
        `UPDATE users SET coins = coins - $1 + $2, trade_bots = trade_bots + 1, last_passive = NOW()
         WHERE user_id = $3`, [cost, earned, userId]);
      await client.query('COMMIT');
      return { ok: `🤖 Bought trade bot #${u.trade_bots + 1} for ${cost.toLocaleString()}.` };
    }
    if (kind === 'storage') {
      const purchases = Math.round((u.storage_cap - 50) / STORAGE_STEP);
      const cost = STORAGE_BASE * (purchases + 1);
      if (u.coins < cost) { await client.query('ROLLBACK'); return { error: `Need ${cost.toLocaleString()} coins.` }; }
      await client.query(
        'UPDATE users SET coins = coins - $1, storage_cap = storage_cap + $2 WHERE user_id = $3',
        [cost, STORAGE_STEP, userId]);
      await client.query('COMMIT');
      return { ok: `📦 Storage expanded to ${u.storage_cap + STORAGE_STEP} slots.` };
    }
    if (kind === 'fee') {
      if (u.sell_fee <= FEE_MIN) { await client.query('ROLLBACK'); return { error: `Already at minimum (${FEE_MIN}%).` }; }
      if (u.coins < FEE_COST) { await client.query('ROLLBACK'); return { error: `Need ${FEE_COST.toLocaleString()} coins.` }; }
      await client.query('UPDATE users SET coins = coins - $1, sell_fee = sell_fee - 1 WHERE user_id = $2',
        [FEE_COST, userId]);
      await client.query('COMMIT');
      return { ok: `🏷️ Sell fee reduced to ${u.sell_fee - 1}%.` };
    }
    await client.query('ROLLBACK');
    return { error: 'Unknown upgrade.' };
  } catch (e) { await client.query('ROLLBACK'); throw e; }
  finally { client.release(); }
}

// ── UNLIST from market ──────────────────────────────────────────────
export async function unlistListing(userId, listingId) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      'SELECT * FROM market_listings WHERE listing_id = $1 AND seller_id = $2 FOR UPDATE',
      [listingId, userId]);
    const lst = rows[0];
    if (!lst) { await client.query('ROLLBACK'); return { error: `You have no listing #${listingId}.` }; }
    await client.query(
      `INSERT INTO inventory (user_id, skin_id, name, rarity, wear, stattrak, value, image)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [userId, lst.skin_id, lst.name, lst.rarity, lst.wear, lst.stattrak, lst.base_value, lst.image]);
    await client.query('DELETE FROM market_listings WHERE listing_id = $1', [listingId]);
    await client.query('COMMIT');
    return { ok: `↩️ Unlisted **${lst.name}** — returned to your inventory.` };
  } catch (e) { await client.query('ROLLBACK'); throw e; }
  finally { client.release(); }
}

// ── "Your listings" screen with unlist buttons ──────────────────────
export async function myListingsScreen(userId) {
  await getOrCreateUser(userId);
  const { rows } = await pool.query(
    'SELECT * FROM market_listings WHERE seller_id = $1 ORDER BY price ASC LIMIT 5', [userId]);

  const embed = new EmbedBuilder().setColor(0x4b69ff).setTitle('🏷️ Your Market Listings');
  const components = [];
  if (rows.length === 0) {
    embed.setDescription('You have no active listings. List one with `/market list`.');
  } else {
    embed.setDescription(rows.map((r) => {
      const e = RARITY_EMOJI[r.rarity] ?? '▫️';
      const name = r.name.length > 32 ? r.name.slice(0, 29) + '…' : r.name;
      return `${e} \`#${r.listing_id}\` ${r.stattrak ? 'ST™ ' : ''}**${name}** — **${Number(r.price).toLocaleString()}**`;
    }).join('\n'));
    components.push(row(...rows.map((r) =>
      b(`market:unlist:${r.listing_id}`, `Unlist #${r.listing_id}`, ButtonStyle.Danger, '↩️'))));
  }
  components.push(navRow('market'));
  return { embeds: [embed], components };
}

// ── MARKET buy ──────────────────────────────────────────────────────
export async function buyListing(userId, listingId) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      'SELECT * FROM market_listings WHERE listing_id = $1 FOR UPDATE', [listingId]);
    const lst = rows[0];
    if (!lst) { await client.query('ROLLBACK'); return { error: `Listing #${listingId} is gone.` }; }
    if (lst.seller_id === userId) { await client.query('ROLLBACK'); return { error: 'You can\'t buy your own listing.' }; }

    const { rows: [buyer] } = await client.query(
      'SELECT coins, storage_cap FROM users WHERE user_id = $1 FOR UPDATE', [userId]);
    if (buyer.coins < lst.price) { await client.query('ROLLBACK'); return { error: `Need ${Number(lst.price).toLocaleString()} coins.` }; }
    const { rows: [{ count }] } = await client.query(
      'SELECT COUNT(*) FROM inventory WHERE user_id = $1', [userId]);
    if (Number(count) >= buyer.storage_cap) { await client.query('ROLLBACK'); return { error: 'Your storage is full.' }; }

    const fee = Math.round(Number(lst.price) * (MARKET_FEE / 100));
    const payout = Number(lst.price) - fee;
    await client.query('UPDATE users SET coins = coins - $1 WHERE user_id = $2', [lst.price, userId]);
    await client.query('UPDATE users SET coins = coins + $1 WHERE user_id = $2', [payout, lst.seller_id]);
    await client.query(
      `INSERT INTO inventory (user_id, skin_id, name, rarity, wear, stattrak, value, image)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [userId, lst.skin_id, lst.name, lst.rarity, lst.wear, lst.stattrak, lst.base_value, lst.image]);
    await client.query('DELETE FROM market_listings WHERE listing_id = $1', [listingId]);
    await client.query('COMMIT');
    return { boughtText: `🛒 Bought **${lst.stattrak ? 'ST™ ' : ''}${lst.name}** for **${Number(lst.price).toLocaleString()}** coins.` };
  } catch (e) { await client.query('ROLLBACK'); throw e; }
  finally { client.release(); }
}
