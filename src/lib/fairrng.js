// Fairness core. Every casino game draws randomness from here, so there's one
// audited source. Uses Node's crypto for cryptographically-strong randomness
// (not Math.random, which is predictable). Each function's odds are documented
// so the house edge is transparent and intentional — nothing is rigged
// per-spin; the edge comes only from payout ratios vs true probabilities.

import { randomInt } from 'crypto';

// Uniform integer in [min, max] inclusive, crypto-strong.
export function rnd(min, max) {
  return randomInt(min, max + 1);
}

// Pick a random element from an array.
export function pick(arr) {
  return arr[randomInt(0, arr.length)];
}

// Weighted pick: items is [{ value, weight }]. Returns a value.
export function weighted(items) {
  const total = items.reduce((a, i) => a + i.weight, 0);
  let r = randomInt(0, total); // 0..total-1
  for (const it of items) {
    if (r < it.weight) return it.value;
    r -= it.weight;
  }
  return items[items.length - 1].value;
}

// Returns true with probability p (0..1). Uses a fine-grained integer roll
// so floating point can't skew it.
export function chance(p) {
  const PRECISION = 1_000_000;
  return randomInt(0, PRECISION) < Math.round(p * PRECISION);
}

// A standard 52-card deck, shuffled with Fisher-Yates using crypto randomness.
export function shuffledDeck() {
  const suits = ['♠', '♥', '♦', '♣'];
  const ranks = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
  const deck = [];
  for (const s of suits) for (const r of ranks) deck.push({ rank: r, suit: s });
  for (let i = deck.length - 1; i > 0; i--) {
    const j = randomInt(0, i + 1);
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}
