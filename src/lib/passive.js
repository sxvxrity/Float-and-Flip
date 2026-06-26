// Passive income from trade bots. Each bot earns a flat rate per hour.
// Income is calculated lazily: whenever the user runs /invest (or /daily),
// we work out how much accrued since last_passive and pay it out.

import { botEfficiencyMult } from './upgrades.js';

export const COINS_PER_BOT_PER_HOUR = 50;
export const MAX_ACCRUAL_HOURS = 24; // cap so offline earnings don't run away

// Returns { earned, hours } for a user row, without mutating anything.
export function calcPassive(user) {
  if (user.trade_bots <= 0) return { earned: 0, hours: 0 };

  const last = new Date(user.last_passive).getTime();
  const now = Date.now();
  let hours = (now - last) / 3_600_000;
  hours = Math.min(hours, MAX_ACCRUAL_HOURS);

  // Bot Efficiency upgrade multiplies the per-bot rate.
  const rate = COINS_PER_BOT_PER_HOUR * botEfficiencyMult(user.upgrades);
  const earned = Math.floor(hours * user.trade_bots * rate);
  return { earned, hours };
}
