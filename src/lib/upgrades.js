// Central catalog of all upgrades. Each upgrade has a cost curve, a max level,
// and an effect read by the relevant system (passive income, case rolls, etc.).
// Levels are stored per-user in the `upgrades` JSONB column (see db.js), so
// adding a new upgrade here needs no schema change.

// cost(level) = round(base * mult^level) rounded to nearest 50.
function curve(base, mult) {
  return (level) => Math.round((base * Math.pow(mult, level)) / 50) * 50;
}

export const UPGRADES = {
  bot_efficiency: {
    name: 'Bot Efficiency', emoji: '⚙️', max: 10, cost: curve(3000, 1.6),
    desc: '+10% trade-bot income per level',
  },
  float_scanner: {
    name: 'Float Scanner', emoji: '🔬', max: 5, cost: curve(2500, 1.7),
    desc: 'Better wear (float) on case pulls',
  },
  rare_hunter: {
    name: 'Rare Hunter', emoji: '🎯', max: 5, cost: curve(4000, 1.8),
    desc: 'Better rarity odds on case pulls',
  },
  case_discount: {
    name: 'Case Discount', emoji: '🏷️', max: 5, cost: curve(2000, 1.7),
    desc: '-5% case cost per level',
  },
  daily_boost: {
    name: 'Daily Boost', emoji: '📅', max: 8, cost: curve(1500, 1.6),
    desc: '+150 daily reward per level',
  },
  match_winnings: {
    name: 'Match Winnings', emoji: '🏅', max: 8, cost: curve(2000, 1.6),
    desc: '+10% match coin rewards per level',
  },
};

// Read a user's level in an upgrade (0 if none). `upgrades` is the parsed
// JSONB object from the user row.
export function level(upgrades, key) {
  return (upgrades && upgrades[key]) || 0;
}

// ── Effect helpers — each system calls the one it needs ──

// Multiplier on trade-bot income (1.0 at level 0, +10% per level).
export function botEfficiencyMult(upgrades) {
  return 1 + 0.10 * level(upgrades, 'bot_efficiency');
}

// Case cost multiplier (1.0 at level 0, -5% per level, floored at 50%).
export function caseCostMult(upgrades) {
  return Math.max(0.5, 1 - 0.05 * level(upgrades, 'case_discount'));
}

// Daily bonus added flat (+150 per level).
export function dailyBonus(upgrades) {
  return 150 * level(upgrades, 'daily_boost');
}

// Match winnings multiplier (+10% per level).
export function matchMult(upgrades) {
  return 1 + 0.10 * level(upgrades, 'match_winnings');
}

// Float scanner: shifts wear odds toward better conditions. Returns a 0..5
// strength used by the skin roller.
export function floatScannerLevel(upgrades) {
  return level(upgrades, 'float_scanner');
}

// Rare hunter: returns a small dropBoost (1.0 = none) for the rarity roll.
// Each level adds a gentle nudge; capped so it can't break the economy.
export function rareHunterBoost(upgrades) {
  return 1 + 0.06 * level(upgrades, 'rare_hunter'); // lv5 => 1.30, safe range
}
