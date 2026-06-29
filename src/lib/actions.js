// The "actions" layer. Each function performs a game action and/or builds a
// screen (embed + buttons), taking only a userId and args — it doesn't care
// whether a slash command or a button triggered it. Slash commands and the
// button handler both call these, so game logic lives in exactly one place.

import { EmbedBuilder, ButtonStyle } from 'discord.js';
import { pool, getOrCreateUser } from './db.js';
import { rollSkin, skinValue, valueSqlExpression } from './skins.js';
import { calcPassive, COINS_PER_BOT_PER_HOUR } from './passive.js';
import { RARITY_EMOJI, wearBar, color } from './visuals.js';
import { navRow, earnRow, playRow, row, sellButton, buyButton, marketNav, Btn, ownedFooter } from './components.js';
import {
  UPGRADES, level, caseCostMult, floatScannerLevel, rareHunterBoost, dailyBonus,
} from './upgrades.js';

const b = Btn.b; // button builder shorthand

const CASE_COST = 250;
const PAGE_SIZE = 5;          // smaller pages so each can carry a Buy button row
const MARKET_FEE = 5;

// ── HUB ─────────────────────────────────────────────────────────────
export async function hubScreen(userId, { overrideEarned, confirmText } = {}) {
  const user = await getOrCreateUser(userId);
  const { rows: [{ count }] } = await pool.query(
    'SELECT COUNT(*) FROM inventory WHERE user_id = $1', [userId]);
  const earned = overrideEarned !== undefined ? overrideEarned : calcPassive(user).earned;

  const { rows: items } = await pool.query(
    'SELECT name, rarity, wear, stattrak, image FROM inventory WHERE user_id = $1', [userId]);
  let topItem = null;
  for (const it of items) {
    const v = skinValue({ rarity: it.rarity, wear: it.wear, stattrak: it.stattrak });
    if (!topItem || v > topItem.value) topItem = { ...it, value: v };
  }

  const embed = new EmbedBuilder()
    .setColor(0x4b69ff)
    .setTitle('🏠 Your Skin Hub')
    .setDescription(
      (confirmText ? `${confirmText}\n\n` : '') +
      `💰 **${user.coins.toLocaleString()}** coins\n` +
      `🎒 **${count}/${user.storage_cap}** skins\n` +
      `🤖 **${user.trade_bots}** trade bot(s)` +
      (earned > 0 ? ` · **${earned.toLocaleString()}** ready to collect` : '')
    )
    .setFooter(ownedFooter(userId, 'Open cases, collect income, climb the leaderboard'));

  if (topItem) {
    const e = RARITY_EMOJI[topItem.rarity] ?? '▫️';
    embed.addFields({
      name: '💎 Most valuable skin',
      value: `${e} ${topItem.stattrak ? 'StatTrak™ ' : ''}**${topItem.name}**\n` +
        `${topItem.wear} · worth **${topItem.value.toLocaleString()}** coins`,
    });
    if (topItem.image) embed.setThumbnail(topItem.image);
  }

  return { embeds: [embed], components: [earnRow(), playRow(), navRow('shack')] };
}

// ── CASE QUANTITY PICKER ─────────────────────────────────────────────
// Shown when the user clicks Open Case — lets them pick 1/3/5/10.
export async function casePicker(userId) {
  const user = await getOrCreateUser(userId);
  const cost = Math.round(CASE_COST * caseCostMult(user.upgrades));
  const embed = new EmbedBuilder().setColor(0x4b69ff)
    .setTitle('📦 Open Cases')
    .setDescription(
      `💰 **${user.coins.toLocaleString()}** coins\n` +
      `📦 Each case costs **${cost.toLocaleString()}** coins\n\n` +
      `How many do you want to open?`)
    .setFooter(ownedFooter(userId));
  const qtyRow = row(
    b('case:open:1',  '× 1',  ButtonStyle.Primary),
    b('case:open:3',  '× 3',  ButtonStyle.Primary),
    b('case:open:5',  '× 5',  ButtonStyle.Primary),
    b('case:open:10', '× 10', ButtonStyle.Primary),
  );
  return { embeds: [embed], components: [qtyRow, navRow()] };
}

// ── OPEN CASE (single) ───────────────────────────────────────────────
// Returns { result, animate } — animate is true when the caller should play
// the reveal (slash command does; buttons jump straight to result for speed).
export async function openCase(userId) {
  const user = await getOrCreateUser(userId);
  // Case Discount upgrade lowers the cost; Rare Hunter and Float Scanner
  // improve the drop. All read from the user's upgrade levels.
  const cost = Math.round(CASE_COST * caseCostMult(user.upgrades));
  if (user.coins < cost) {
    return { error: `You need ${cost.toLocaleString()} coins. You have ${user.coins.toLocaleString()}.` };
  }

  const drop = await rollSkin(rareHunterBoost(user.upgrades), floatScannerLevel(user.upgrades));
  const client = await pool.connect();
  let outcome = 'ok';
  try {
    await client.query('BEGIN');
    const pay = await client.query(
      'UPDATE users SET coins = coins - $1 WHERE user_id = $2 AND coins >= $1',
      [cost, userId]);
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

  if (outcome === 'broke') return { error: `You no longer have ${cost.toLocaleString()} coins.` };
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

// ── OPEN CASE MULTI ──────────────────────────────────────────────────
// Opens qty cases in one go, returns a summary embed of all drops.
export async function openCaseMulti(userId, qty) {
  const user = await getOrCreateUser(userId);
  const costPer = Math.round(CASE_COST * caseCostMult(user.upgrades));
  const totalCost = costPer * qty;

  if (user.coins < totalCost) {
    return { error: `You need **${totalCost.toLocaleString()}** coins for ×${qty} cases. You have **${user.coins.toLocaleString()}**.` };
  }

  const client = await pool.connect();
  const drops = [];
  let rareDrops = [];
  let skipped = 0;

  try {
    await client.query('BEGIN');

    // Deduct total cost atomically upfront.
    const pay = await client.query(
      'UPDATE users SET coins = coins - $1 WHERE user_id = $2 AND coins >= $1',
      [totalCost, userId]);
    if (pay.rowCount === 0) { await client.query('ROLLBACK'); return { error: `You no longer have ${totalCost.toLocaleString()} coins.` }; }

    // Roll each skin and insert — skip if storage full.
    for (let i = 0; i < qty; i++) {
      const drop = await rollSkin(rareHunterBoost(user.upgrades), floatScannerLevel(user.upgrades));
      const ins = await client.query(
        `INSERT INTO inventory (user_id, skin_id, name, rarity, wear, stattrak, value, image)
         SELECT $1,$2,$3,$4,$5,$6,$7,$8
         WHERE (SELECT COUNT(*) FROM inventory WHERE user_id = $1) < $9`,
        [userId, drop.skin_id, drop.name, drop.rarity, drop.wear, drop.stattrak, drop.value, drop.image, user.storage_cap]);
      if (ins.rowCount === 0) { skipped++; } else { drops.push(drop); }
      if (['Covert', 'Extraordinary'].includes(drop.rarity)) rareDrops.push(drop);
    }

    // Refund the cost of any skipped cases — player shouldn't pay for cases
    // they couldn't receive due to full storage.
    if (skipped > 0) {
      const refund = costPer * skipped;
      await client.query('UPDATE users SET coins = coins + $1 WHERE user_id = $2', [refund, userId]);
    }

    await client.query('COMMIT');
  } catch (e) { await client.query('ROLLBACK'); throw e; }
  finally { client.release(); }

  if (drops.length === 0) return { error: `Storage full — sell some skins first.` };

  // Build summary embed.
  const totalValue = drops.reduce((s, d) => s + d.value, 0);
  const best = drops.reduce((a, b) => a.value > b.value ? a : b);
  const bestEmoji = RARITY_EMOJI[best.rarity] ?? '▫️';

  const lines = drops.map((d) => {
    const e = RARITY_EMOJI[d.rarity] ?? '▫️';
    return `${e} ${d.stattrak ? 'ST™ ' : ''}**${d.name}** — ${d.value.toLocaleString()}`;
  });

  const embed = new EmbedBuilder().setColor(color(best.rarity))
    .setTitle(`📦 Opened ×${drops.length} Case${drops.length > 1 ? 's' : ''}`)
    .setDescription(lines.join('\n'))
    .addFields(
      { name: '💎 Best drop', value: `${bestEmoji} ${best.stattrak ? 'ST™ ' : ''}${best.name} (${best.value.toLocaleString()})`, inline: true },
      { name: '💰 Total value', value: totalValue.toLocaleString(), inline: true },
    )
    .setThumbnail(best.image || null);

  if (skipped > 0) embed.setFooter(ownedFooter(userId, `${skipped} skin(s) skipped — storage full`));
  else embed.setFooter(ownedFooter(userId));

  return {
    rareDrops,
    payload: { embeds: [embed], components: [earnRow(), navRow()] },
  };
}

// ── DAILY ───────────────────────────────────────────────────────────
export async function claimDaily(userId) {
  const DAILY_BASE = 500, COOLDOWN_MS = 20 * 3_600_000;
  const user = await getOrCreateUser(userId);
  // Daily Boost upgrade adds a flat bonus per level.
  const total = DAILY_BASE + Math.floor(Math.random() * 300) + dailyBonus(user.upgrades);
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
  return { payload: await hubScreen(userId, { confirmText: `✅ Daily claimed **+${total.toLocaleString()}** coins · come back in 20 hours` }) };
}

// ── COLLECT (invest) ────────────────────────────────────────────────
export async function collectIncome(userId) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // Lock the row so concurrent collects can't race.
    const { rows: [user] } = await client.query(
      'SELECT * FROM users WHERE user_id = $1 FOR UPDATE', [userId]);
    if (!user) { await client.query('ROLLBACK'); return { error: 'User not found.' }; }
    if (user.trade_bots <= 0) { await client.query('ROLLBACK'); return { error: 'No trade bots yet. Buy one with `/upgrade tradebot`.' }; }

    const { earned, hours } = calcPassive(user);
    if (earned <= 0) { await client.query('ROLLBACK'); return { error: 'Nothing to collect yet — check back soon.' }; }

    await client.query(
      'UPDATE users SET coins = coins + $1, last_passive = NOW() WHERE user_id = $2',
      [earned, userId]);
    await client.query('COMMIT');

    const confirmText = `✅ Collected **+${earned.toLocaleString()}** coins from ${user.trade_bots} bot(s) over ${hours.toFixed(1)}h`;
    return { payload: await hubScreen(userId, { overrideEarned: 0, confirmText }) };
  } catch (e) { await client.query('ROLLBACK'); throw e; }
  finally { client.release(); }
}

// ── INVENTORY ───────────────────────────────────────────────────────
// Shows up to 5 skins, each with its own Sell button row.
export async function inventoryScreen(userId) {
  const user = await getOrCreateUser(userId);
  const { rows } = await pool.query(
    'SELECT id, name, rarity, wear, stattrak, locked FROM inventory WHERE user_id = $1', [userId]);

  const priced = rows
    .map((r) => ({ ...r, live: skinValue({ rarity: r.rarity, wear: r.wear, stattrak: r.stattrak }) }))
    .sort((a, b) => b.live - a.live);
  const total = priced.reduce((a, r) => a + r.live, 0);
  const lockedCount = priced.filter((r) => r.locked).length;

  const embed = new EmbedBuilder().setColor(0x4b69ff)
    .setTitle('🎒 Your Inventory')
    .setDescription(
      `💰 **${user.coins.toLocaleString()}** coins · ` +
      `📦 **${priced.length}/${user.storage_cap}** · total **${total.toLocaleString()}**` +
      (lockedCount > 0 ? ` · 🔒 **${lockedCount}** locked` : ''));

  const components = [];
  if (priced.length === 0) {
    embed.addFields({ name: 'Empty', value: 'Open a case to get started.' });
  } else {
    // Show top 3 — saves room for Sell All + up to 2 lock buttons.
    const top = priced.slice(0, 3);
    embed.setDescription(embed.data.description + '\n\n' + top.map((r) => {
      const e = RARITY_EMOJI[r.rarity] ?? '▫️';
      const name = r.name.length > 28 ? r.name.slice(0, 25) + '…' : r.name;
      const lockIcon = r.locked ? '🔒 ' : '';
      return `${lockIcon}${e} \`#${r.id}\` ${r.stattrak ? 'ST™ ' : ''}**${name}** \`${wearBar(r.wear)}\` — ${r.live.toLocaleString()}`;
    }).join('\n') + (priced.length > 3 ? `\n*…and ${priced.length - 3} more*` : ''));

    // Sell row: sell buttons for unlocked top items + Sell All.
    const sellRow = row(
      ...top.filter((r) => !r.locked).slice(0, 3).map((r) => sellButton(r.id).setLabel(`Sell #${r.id}`)),
      Btn.b('sell:all', 'Sell All', ButtonStyle.Danger, '💸'),
    );
    components.push(sellRow);

    // Lock row: toggle lock on top items (up to 3).
    const lockRow = row(
      ...top.map((r) => Btn.b(
        `lock:${r.id}`,
        r.locked ? `🔓 #${r.id}` : `🔒 #${r.id}`,
        r.locked ? ButtonStyle.Secondary : ButtonStyle.Primary,
      )),
    );
    components.push(lockRow);
  }
  components.push(navRow('inventory'));
  embed.setFooter(ownedFooter(userId, '🔒 Lock a skin to protect it from Sell All'));
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
      'DELETE FROM inventory WHERE id = $1 AND user_id = $2 AND locked = FALSE RETURNING *', [itemId, userId]);
    const item = rows[0];
    if (!item) {
      await client.query('ROLLBACK');
      const { rows: [check] } = await client.query(
        'SELECT locked FROM inventory WHERE id = $1 AND user_id = $2', [itemId, userId]);
      if (check?.locked) return { error: `🔒 Skin #${itemId} is locked. Unlock it first.` };
      return { error: `No skin #${itemId} in your inventory.` };
    }
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

// ── TOGGLE LOCK ──────────────────────────────────────────────────────
// Locks or unlocks a skin. Locked skins are skipped by Sell All.
export async function toggleLock(userId, itemId) {
  const { rows: [item] } = await pool.query(
    'UPDATE inventory SET locked = NOT locked WHERE id = $1 AND user_id = $2 RETURNING *',
    [itemId, userId]);
  if (!item) return { error: 'Skin not found in your inventory.' };
  return { locked: item.locked, name: item.name };
}
// Atomically sells every UNLOCKED skin. Locked skins are preserved as trophies.
export async function sellAll(userId) {
  const user = await getOrCreateUser(userId);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      'DELETE FROM inventory WHERE user_id = $1 AND locked = FALSE RETURNING *', [userId]);
    if (rows.length === 0) {
      await client.query('ROLLBACK');
      const { rows: [{ count }] } = await client.query(
        'SELECT COUNT(*) FROM inventory WHERE user_id = $1', [userId]);
      if (Number(count) > 0) return { error: '🔒 All your skins are locked. Unlock them to sell.' };
      return { error: 'Your inventory is already empty.' };
    }
    let totalPayout = 0;
    for (const item of rows) {
      const live = skinValue({ rarity: item.rarity, wear: item.wear, stattrak: item.stattrak });
      const market = Math.round(live * (0.85 + Math.random() * 0.3));
      const fee = Math.round(market * (user.sell_fee / 100));
      totalPayout += market - fee;
    }
    await client.query('UPDATE users SET coins = coins + $1 WHERE user_id = $2', [totalPayout, userId]);
    await client.query('COMMIT');
    return { count: rows.length, totalPayout };
  } catch (e) { await client.query('ROLLBACK'); throw e; }
  finally { client.release(); }
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
      const seller = r.seller_id === 'bot_market_system' ? '🤖' : '👤';
      return `${seller} ${e} \`#${r.listing_id}\` ${r.stattrak ? 'ST™ ' : ''}**${name}** \`${wearBar(r.wear)}\` — **${Number(r.price).toLocaleString()}**`;
    }).join('\n')).setFooter(ownedFooter(userId, `Page ${page}/${totalPages} · ${total} listings · 🤖 = bot listing`));
    // A row of Buy buttons, labelled by listing id.
    components.push(row(...rows.map((r) => buyButton(r.listing_id).setLabel(`Buy #${r.listing_id}`))));
  }
  components.push(marketNav(page, totalPages));
  return { embeds: [embed], components };
}

// ── UPGRADES ────────────────────────────────────────────────────────
// Two kinds of upgrade live here:
//   1. The three "core" upgrades with bespoke effects (trade bot, storage, fee)
//   2. The catalog upgrades from upgrades.js (bot efficiency, scanners, etc.)
// All are shown on one clean shop screen with a Buy button each.
const TRADEBOT_BASE = 500, STORAGE_STEP = 25, STORAGE_BASE = 1500;
const FEE_MIN = 3, FEE_COST = 5000;

function coreCosts(u) {
  const botCost = TRADEBOT_BASE * (u.trade_bots + 1);
  const storagePurchases = Math.round((u.storage_cap - 50) / STORAGE_STEP);
  const storageCost = STORAGE_BASE * (storagePurchases + 1);
  return { botCost, storageCost, feeCost: FEE_COST };
}

export async function upgradeScreen(userId) {
  const user = await getOrCreateUser(userId);
  const { botCost, storageCost, feeCost } = coreCosts(user);
  const ups = user.upgrades || {};

  const embed = new EmbedBuilder().setColor(0x4b69ff)
    .setTitle('🛠️ Upgrades')
    .setDescription(`💰 You have **${user.coins.toLocaleString()}** coins\nTap a button to buy. Costs rise each level.`);

  // Core upgrades.
  embed.addFields(
    { name: `🤖 Trade Bot — ${botCost.toLocaleString()}`,
      value: `Owned: **${user.trade_bots}** · passive income`, inline: true },
    { name: `📦 Storage +${STORAGE_STEP} — ${storageCost.toLocaleString()}`,
      value: `Cap: **${user.storage_cap}**`, inline: true },
    { name: `🏷️ Sell Fee −1% — ${feeCost.toLocaleString()}`,
      value: user.sell_fee <= FEE_MIN ? `Min (**${FEE_MIN}%**)` : `Now: **${user.sell_fee}%**`, inline: true },
  );

  // Catalog upgrades (levelled).
  for (const [key, u] of Object.entries(UPGRADES)) {
    const lvl = level(ups, key);
    const maxed = lvl >= u.max;
    embed.addFields({
      name: `${u.emoji} ${u.name} — ${maxed ? 'MAX' : u.cost(lvl).toLocaleString()}`,
      value: `Lv **${lvl}/${u.max}** · ${u.desc}`, inline: true,
    });
  }

  // Buy buttons. Discord caps 5 rows & 5 buttons/row. We have 9 upgrades, so
  // we lay them out as rows of buy buttons, then the nav row last (5 rows max).
  const coreRow = row(
    b('upgrade:tradebot', 'Bot', ButtonStyle.Success, '🤖'),
    b('upgrade:storage', 'Storage', ButtonStyle.Success, '📦'),
    user.sell_fee > FEE_MIN ? b('upgrade:fee', 'Fee', ButtonStyle.Success, '🏷️') : null,
  );
  // Catalog upgrades split across two rows (up to 5 each). Maxed ones are
  // disabled so you can see they're complete.
  const catKeys = Object.keys(UPGRADES);
  const mkBtn = (key) => {
    const u = UPGRADES[key];
    const maxed = level(ups, key) >= u.max;
    const btn = b(`upgrade:cat:${key}`, u.name.split(' ')[0], ButtonStyle.Primary, u.emoji);
    if (maxed) btn.setDisabled(true).setStyle(ButtonStyle.Secondary);
    return btn;
  };
  const catRow1 = row(...catKeys.slice(0, 3).map(mkBtn));
  const catRow2 = row(...catKeys.slice(3, 6).map(mkBtn));

  embed.setFooter(ownedFooter(userId));
  return { embeds: [embed], components: [coreRow, catRow1, catRow2, navRow('upgrade')] };
}

// Performs a purchase. kind = 'tradebot' | 'storage' | 'fee' | 'cat:<key>'.
export async function buyUpgrade(userId, kind, catKey) {
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
    if (kind === 'cat') {
      const def = UPGRADES[catKey];
      if (!def) { await client.query('ROLLBACK'); return { error: 'Unknown upgrade.' }; }
      const ups = u.upgrades || {};
      const lvl = level(ups, catKey);
      if (lvl >= def.max) { await client.query('ROLLBACK'); return { error: `${def.name} is already maxed.` }; }
      const cost = def.cost(lvl);
      if (u.coins < cost) { await client.query('ROLLBACK'); return { error: `Need ${cost.toLocaleString()} coins.` }; }
      // Collect pending passive before changing bot efficiency, so the new
      // multiplier doesn't retroactively apply to already-accrued time.
      const { earned } = calcPassive(u);
      const newUps = { ...ups, [catKey]: lvl + 1 };
      await client.query(
        `UPDATE users SET coins = coins - $1 + $2, upgrades = $3::jsonb, last_passive = NOW()
         WHERE user_id = $4`,
        [cost, earned, JSON.stringify(newUps), userId]);
      await client.query('COMMIT');
      return { ok: `${def.emoji} ${def.name} upgraded to Lv ${lvl + 1} for ${cost.toLocaleString()}.` };
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
  embed.setFooter(ownedFooter(userId));
  return { embeds: [embed], components };
}

// ── LEADERBOARD ─────────────────────────────────────────────────────
// Needs `client` to resolve usernames and `userId` for the caller's own rank.
// sort = 'inventory' | 'coins'. Toggle buttons swap between them.
const LB_TOP_N = 10;

export async function leaderboardScreen(client, userId, sort = 'inventory') {
  await getOrCreateUser(userId);
  const metric = sort === 'coins' ? 'u.coins' : 'COALESCE(inv.total, 0)';
  const { rows } = await pool.query(`
    WITH inv AS (
      SELECT user_id, SUM(${valueSqlExpression()}) AS total
      FROM inventory GROUP BY user_id
    ),
    ranked AS (
      SELECT u.user_id, u.coins,
             COALESCE(inv.total, 0) AS inv_value,
             RANK() OVER (ORDER BY ${metric} DESC) AS rank
      FROM users u LEFT JOIN inv ON inv.user_id = u.user_id
      WHERE u.user_id != 'bot_market_system'
    )
    SELECT * FROM ranked ORDER BY rank ASC
  `);

  const embed = new EmbedBuilder().setColor(0xf1c40f)
    .setTitle(`🏆 Leaderboard — ${sort === 'coins' ? 'Coins' : 'Inventory Value'}`);

  if (rows.length === 0) {
    embed.setDescription('No traders yet. Be the first with `/case`.');
  } else {
    const medals = ['🥇', '🥈', '🥉'];
    const fmt = (r) => sort === 'coins'
      ? `${Number(r.coins).toLocaleString()} coins`
      : `${Number(r.inv_value).toLocaleString()} value`;

    const top = rows.slice(0, LB_TOP_N);
    const lines = await Promise.all(top.map(async (r, i) => {
      let name = `User ${r.user_id.slice(0, 6)}`;
      try { name = (await client.users.fetch(r.user_id)).username; } catch { /* left server */ }
      return `${medals[i] ?? `**${i + 1}.**`} ${name} — ${fmt(r)}`;
    }));
    embed.setDescription(lines.join('\n'));

    const me = rows.find((r) => r.user_id === userId);
    if (me && me.rank > LB_TOP_N) {
      embed.addFields({ name: 'Your rank', value: `**#${me.rank}** of ${rows.length} — ${fmt(me)}` });
    }
  }

  // Sort toggle: highlight the active sort, offer the other.
  const toggleRow = row(
    b('lb:inventory', 'By Value', sort === 'inventory' ? ButtonStyle.Success : ButtonStyle.Secondary, '💎'),
    b('lb:coins', 'By Coins', sort === 'coins' ? ButtonStyle.Success : ButtonStyle.Secondary, '💰'),
  );
  embed.setFooter(ownedFooter(userId));
  return { embeds: [embed], components: [toggleRow, navRow()] };
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
    // Bot listings: coins are removed from buyer but not credited anywhere = coin sink.
    if (lst.seller_id !== 'bot_market_system') {
      await client.query('UPDATE users SET coins = coins + $1 WHERE user_id = $2', [payout, lst.seller_id]);
    }
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
