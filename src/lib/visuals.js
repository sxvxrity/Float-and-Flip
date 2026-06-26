// Shared visual helpers so every command renders skins consistently.

// Coloured squares per rarity — reads at a glance in inventory lists.
// Swap any of these for your own custom server emoji (e.g. '<:covert:123…>').
export const RARITY_EMOJI = {
  'Consumer Grade':   '⬜',
  'Industrial Grade': '🟦',
  'Mil-Spec Grade':   '🟦',
  'Restricted':       '🟪',
  'Classified':       '🟪',
  'Covert':           '🟥',
  'Extraordinary':    '🟨',
};

// Embed sidebar colours matching CS2's rarity scheme.
export const RARITY_COLOR = {
  'Consumer Grade':   0xb0c3d9,
  'Industrial Grade': 0x5e98d9,
  'Mil-Spec Grade':   0x4b69ff,
  'Restricted':       0x8847ff,
  'Classified':       0xd32ce6,
  'Covert':           0xeb4b4b,
  'Extraordinary':    0xffd700,
};

// Each wear maps to a filled-bar fraction (FN = full, BS = nearly empty).
const WEAR_FILL = {
  'Factory New':    5,
  'Minimal Wear':   4,
  'Field-Tested':   3,
  'Well-Worn':      2,
  'Battle-Scarred': 1,
};

// Render a 5-segment float bar, e.g. ▰▰▰▱▱ for Field-Tested.
export function wearBar(wear) {
  const filled = WEAR_FILL[wear] ?? 3;
  return '▰'.repeat(filled) + '▱'.repeat(5 - filled);
}

// One-line label for a skin: emoji + StatTrak + name + wear bar.
export function skinLabel(skin) {
  const emoji = RARITY_EMOJI[skin.rarity] ?? '▫️';
  const st = skin.stattrak ? 'StatTrak™ ' : '';
  return `${emoji} ${st}${skin.name}`;
}

export function color(rarity) {
  return RARITY_COLOR[rarity] ?? 0xffffff;
}
