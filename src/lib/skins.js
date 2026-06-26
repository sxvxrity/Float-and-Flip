// Loads real CS2 skin names/rarities/images from ByMykel's CSGO-API,
// then assigns OUR OWN coin values. Authentic names, fictional economy.

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CACHE_PATH = path.join(__dirname, 'skins.cache.json');
const SKINS_URL =
  'https://bymykel.github.io/CSGO-API/api/en/skins.json';

// Rarity order, low -> high. Each tier defines drop weight + base coin value.
export const RARITIES = {
  'Consumer Grade':   { weight: 4000, base: 50 },
  'Industrial Grade': { weight: 2500, base: 150 },
  'Mil-Spec Grade':   { weight: 2000, base: 400 },
  'Restricted':       { weight: 1000, base: 1200 },
  'Classified':       { weight: 350,  base: 4000 },
  'Covert':           { weight: 120,  base: 12000 },
  'Extraordinary':    { weight: 30,   base: 50000 }, // knives / gloves
};

export const RARITY_ORDER = Object.keys(RARITIES);

// Wear conditions and their value multipliers (FN is most valuable).
export const WEARS = [
  { name: 'Factory New',    mult: 1.6, weight: 8 },
  { name: 'Minimal Wear',   mult: 1.3, weight: 15 },
  { name: 'Field-Tested',   mult: 1.0, weight: 40 },
  { name: 'Well-Worn',      mult: 0.8, weight: 22 },
  { name: 'Battle-Scarred', mult: 0.6, weight: 15 },
];

const STATTRAK_CHANCE = 0.1;   // 10% of drops
const STATTRAK_MULT = 1.8;

// ── The inflation dial ──────────────────────────────────────────────
// A single multiplier applied to EVERY skin's value at calculation time.
// Lower it (e.g. 0.8) to deflate the economy when coins run hot; raise it
// to inject value. Because /sell and the leaderboard compute value LIVE
// via skinValue() below, changing this instantly re-prices every skin in
// the game — old and new alike. That's the whole point: one lever to
// rebalance the whole economy. Override at runtime with ECONOMY_MULT env var.
export const ECONOMY_MULT = Number(process.env.ECONOMY_MULT) || 1.0;

// Wear name -> multiplier, for quick lookup by stored wear string.
const WEAR_MULT = {
  'Factory New': 1.6, 'Minimal Wear': 1.3, 'Field-Tested': 1.0,
  'Well-Worn': 0.8, 'Battle-Scarred': 0.6,
};

// THE single source of truth for what a skin is worth right now.
// Everything that needs a value (drops, sells, leaderboard) calls this,
// so there's no frozen price tag and no duplicated formula to drift.
export function skinValue({ rarity, wear, stattrak }) {
  const base = RARITIES[rarity]?.base ?? 0;
  const wmult = WEAR_MULT[wear] ?? 1.0;
  return Math.round(base * wmult * (stattrak ? STATTRAK_MULT : 1) * ECONOMY_MULT);
}

// The SAME formula as skinValue(), emitted as a SQL expression so the
// leaderboard can rank by live value without pulling every inventory row
// into Node. Generated from the same constants, so it can't drift from
// skinValue — change RARITIES/WEAR_MULT once and both update together.
export function valueSqlExpression(col = '') {
  const p = col ? `${col}.` : '';
  const rarityCase =
    'CASE ' +
    Object.entries(RARITIES)
      .map(([name, { base }]) => `WHEN ${p}rarity = ${sqlStr(name)} THEN ${base}`)
      .join(' ') +
    ' ELSE 0 END';
  const wearCase =
    'CASE ' +
    Object.entries(WEAR_MULT)
      .map(([name, m]) => `WHEN ${p}wear = ${sqlStr(name)} THEN ${m}`)
      .join(' ') +
    ' ELSE 1.0 END';
  const stMult = `(CASE WHEN ${p}stattrak THEN ${STATTRAK_MULT} ELSE 1 END)`;
  return `ROUND(${rarityCase} * ${wearCase} * ${stMult} * ${ECONOMY_MULT})`;
}

// Minimal SQL string literal escaping (rarity/wear names are our own constants,
// but this keeps it safe and tidy).
function sqlStr(s) {
  return `'${String(s).replace(/'/g, "''")}'`;
}

let SKINS = null; // grouped by rarity once loaded

// Pull the API once and cache to disk so we don't hit it every boot.
export async function loadSkins() {
  if (SKINS) return SKINS;

  let raw;
  if (fs.existsSync(CACHE_PATH)) {
    raw = JSON.parse(fs.readFileSync(CACHE_PATH, 'utf8'));
  } else {
    const res = await fetch(SKINS_URL);
    if (!res.ok) throw new Error(`CSGO-API fetch failed: ${res.status}`);
    raw = await res.json();
    fs.writeFileSync(CACHE_PATH, JSON.stringify(raw));
  }

  // Group skins by the rarity names we support.
  SKINS = {};
  for (const tier of RARITY_ORDER) SKINS[tier] = [];
  for (const s of raw) {
    const tier = s.rarity?.name;
    if (SKINS[tier]) {
      SKINS[tier].push({
        id: s.id,
        name: s.name,
        image: s.image,
      });
    }
  }
  return SKINS;
}

function weightedPick(items, weightFn) {
  const total = items.reduce((a, i) => a + weightFn(i), 0);
  let r = Math.random() * total;
  for (const i of items) {
    r -= weightFn(i);
    if (r <= 0) return i;
  }
  return items[items.length - 1];
}

// Roll a single skin from a case. dropBoost shifts odds toward rarer tiers.
// WARNING: the boost is applied as weight * boost^tierIndex, so it compounds
// HARD on high tiers. At boost 1 it's neutral; boost 2 already makes knives
// ~5% (from 0.3%); boost 3 makes them ~16%. Keep premium cases at boost <= 1.5
// unless you really mean it. The clamp below is a safety rail, not a target.
export async function rollSkin(dropBoost = 1) {
  const boost = Math.min(Math.max(dropBoost, 1), 1.5); // clamp to a sane range
  const skins = await loadSkins();

  // Pick rarity (only tiers that actually have skins loaded)
  const tiers = RARITY_ORDER
    .filter((t) => skins[t].length > 0)
    .map((t) => ({ name: t, ...RARITIES[t] }));

  const tier = weightedPick(tiers, (t) => {
    const idx = RARITY_ORDER.indexOf(t.name);
    return t.weight * Math.pow(boost, idx); // boost favors higher tiers
  });

  const skin = skins[tier.name][Math.floor(Math.random() * skins[tier.name].length)];
  const wear = weightedPick(WEARS, (w) => w.weight);
  const stattrak = Math.random() < STATTRAK_CHANCE;

  const value = skinValue({ rarity: tier.name, wear: wear.name, stattrak });

  return {
    skin_id: skin.id,
    name: skin.name,
    rarity: tier.name,
    wear: wear.name,
    stattrak,
    value,
    image: skin.image,
  };
}
