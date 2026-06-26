// Shared betting helpers. Casino games call placeBet() to atomically deduct a
// stake (rejecting if the player can't afford it), then settle() to pay any
// winnings. Both use the same locked-row pattern as the rest of the economy so
// parallel plays can't overspend or double-pay.

import { pool, getOrCreateUser } from './db.js';

export const MIN_BET = 10;
export const MAX_BET = 1_000_000;

// Validate and atomically deduct a stake. Returns { ok } or { error }.
export async function placeBet(userId, amount) {
  if (!Number.isInteger(amount) || amount < MIN_BET) {
    return { error: `Minimum bet is ${MIN_BET} coins.` };
  }
  if (amount > MAX_BET) {
    return { error: `Maximum bet is ${MAX_BET.toLocaleString()} coins.` };
  }
  await getOrCreateUser(userId);
  // Conditional deduction: only subtracts if balance covers it.
  const res = await pool.query(
    'UPDATE users SET coins = coins - $1 WHERE user_id = $2 AND coins >= $1',
    [amount, userId]
  );
  if (res.rowCount === 0) return { error: 'You don\'t have enough coins for that bet.' };
  return { ok: true };
}

// Pay winnings (gross amount the player receives back, including stake on a win).
// Pass 0 to pay nothing (a loss). Safe to call with any non-negative integer.
export async function settle(userId, payout) {
  if (payout > 0) {
    await pool.query('UPDATE users SET coins = coins + $1 WHERE user_id = $2', [payout, userId]);
  }
  const { rows: [u] } = await pool.query('SELECT coins FROM users WHERE user_id = $1', [userId]);
  return Number(u.coins);
}
