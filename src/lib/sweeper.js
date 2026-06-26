// Periodically buys out listings past their expires_at, paying the seller
// a discounted rate. This is the "system auto-buy floor" — it guarantees
// listings eventually clear even on a quiet server.

import { pool } from './db.js';

const AUTO_BUY_RATE = 0.7;        // seller gets 70% of asking price
const SWEEP_INTERVAL_MS = 5 * 60 * 1000; // check every 5 minutes

async function sweepOnce() {
  // Grab a batch of expired listings, locking them so a concurrent /market buy
  // can't also take one. SKIP LOCKED avoids waiting on rows a buyer is mid-purchase on.
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      `SELECT listing_id, seller_id, price, base_value
       FROM market_listings
       WHERE expires_at <= NOW()
       ORDER BY expires_at ASC
       LIMIT 50
       FOR UPDATE SKIP LOCKED`
    );

    for (const lst of rows) {
      // Pay on the skin's INTRINSIC value, not the asking price — otherwise a
      // seller could list a cheap skin at an absurd price and farm the system.
      // Also cap at the asking price so the floor never beats what they asked.
      const reference = Math.min(Number(lst.base_value), Number(lst.price));
      const payout = Math.floor(reference * AUTO_BUY_RATE);
      await client.query(
        'UPDATE users SET coins = coins + $1 WHERE user_id = $2',
        [payout, lst.seller_id]
      );
      await client.query('DELETE FROM market_listings WHERE listing_id = $1', [lst.listing_id]);
    }
    await client.query('COMMIT');

    if (rows.length > 0) {
      console.log(`[market sweeper] auto-bought ${rows.length} expired listing(s)`);
    }
  } catch (e) {
    await client.query('ROLLBACK');
    console.error('[market sweeper] error:', e);
  } finally {
    client.release();
  }
}

// Start the recurring sweep. Called once from index.js after login.
export function startMarketSweeper() {
  sweepOnce(); // run immediately on boot to clear any backlog
  setInterval(sweepOnce, SWEEP_INTERVAL_MS);
  console.log(`[market sweeper] running every ${SWEEP_INTERVAL_MS / 60000} min`);
}
