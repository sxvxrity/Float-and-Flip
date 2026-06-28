// Keeps a pool of bot-owned listings on the market so there's always something
// to browse, even on a quiet server. Listings are priced with mixed strategy —
// some deals, some overpriced — to make browsing actually interesting.
//
// Bot listings use a reserved user_id (BOT_MARKET_ID) that never appears in
// leaderboards. When a player buys one, their coins are deducted normally but
// credited to nowhere (the BOT_MARKET user, which nobody plays as) — acting as
// a coin sink that helps fight inflation.

import { pool } from './db.js';
import { rollSkin, skinValue } from './skins.js';

export const BOT_MARKET_ID = 'bot_market_system';
const TARGET_MIN = 8;
const TARGET_MAX = 12;
const RESTOCK_INTERVAL_MS = 15 * 60 * 1000; // check every 15 minutes

// Pricing strategies — mixed so some are deals, some are traps.
const PRICE_STRATEGIES = [
  { label: 'deal',       mult: () => 0.70 + Math.random() * 0.15 },  // 70-85% — genuine deal
  { label: 'fair',       mult: () => 0.90 + Math.random() * 0.15 },  // 90-105% — fair value
  { label: 'overpriced', mult: () => 1.20 + Math.random() * 0.30 },  // 120-150% — trap
];
// Weighted: 30% deals, 40% fair, 30% overpriced
const STRATEGY_WEIGHTS = [3, 4, 3];

function pickStrategy() {
  const total = STRATEGY_WEIGHTS.reduce((a, b) => a + b, 0);
  let r = Math.random() * total;
  for (let i = 0; i < PRICE_STRATEGIES.length; i++) {
    r -= STRATEGY_WEIGHTS[i];
    if (r <= 0) return PRICE_STRATEGIES[i];
  }
  return PRICE_STRATEGIES[1];
}

// Listing expiry: 2-6 hours, so the market stays dynamic.
function expiryInterval() {
  const hours = 2 + Math.random() * 4;
  return `${Math.round(hours * 60)} minutes`;
}

async function ensureBotUser() {
  await pool.query(
    `INSERT INTO users (user_id, coins) VALUES ($1, 0)
     ON CONFLICT (user_id) DO NOTHING`,
    [BOT_MARKET_ID]
  );
}

async function restockOnce() {
  try {
    await ensureBotUser();

    // Count current bot listings.
    const { rows: [{ count }] } = await pool.query(
      'SELECT COUNT(*) FROM market_listings WHERE seller_id = $1',
      [BOT_MARKET_ID]
    );
    const current = Number(count);
    const target = TARGET_MIN + Math.floor(Math.random() * (TARGET_MAX - TARGET_MIN + 1));
    const needed = Math.max(0, target - current);

    if (needed === 0) return;

    // Roll that many skins and list them.
    for (let i = 0; i < needed; i++) {
      const skin = await rollSkin();
      const baseValue = skinValue({ rarity: skin.rarity, wear: skin.wear, stattrak: skin.stattrak });
      const strategy = pickStrategy();
      const price = Math.max(10, Math.round(baseValue * strategy.mult()));

      await pool.query(
        `INSERT INTO market_listings
           (seller_id, skin_id, name, rarity, wear, stattrak, price, base_value, image, expires_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW() + INTERVAL '${expiryInterval()}')`,
        [BOT_MARKET_ID, skin.skin_id, skin.name, skin.rarity,
         skin.wear, skin.stattrak, price, baseValue, skin.image]
      );
    }

    console.log(`[bot market] added ${needed} listing(s) (${current} → ${current + needed})`);
  } catch (e) {
    console.error('[bot market] restock error:', e);
  }
}

// Also clean up expired bot listings (the main sweeper pays sellers on expiry,
// but bot listings have no seller to pay — just delete them).
async function cleanExpiredBotListings() {
  try {
    const { rowCount } = await pool.query(
      `DELETE FROM market_listings
       WHERE seller_id = $1 AND expires_at <= NOW()`,
      [BOT_MARKET_ID]
    );
    if (rowCount > 0) console.log(`[bot market] cleared ${rowCount} expired bot listing(s)`);
  } catch (e) {
    console.error('[bot market] cleanup error:', e);
  }
}

export function startBotMarket() {
  const run = async () => {
    await cleanExpiredBotListings();
    await restockOnce();
  };
  run(); // immediately on boot
  setInterval(run, RESTOCK_INTERVAL_MS);
  console.log(`[bot market] running every ${RESTOCK_INTERVAL_MS / 60000} min`);
}
