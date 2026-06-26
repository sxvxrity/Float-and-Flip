import { ButtonBuilder, ButtonStyle, ActionRowBuilder } from 'discord.js';

// ── Button customId convention ──────────────────────────────────────
// All button IDs are "namespace:action[:arg]". The central handler in
// index.js splits on ':' and routes by namespace. Keeping every ID in
// this one file means there's a single place to see the whole menu map.
//
//   case:open            -> open a case
//   nav:inventory        -> show inventory
//   nav:market           -> show market page 1
//   nav:shack            -> show the main hub
//   daily:claim          -> claim daily
//   invest:collect       -> collect passive income
//   sell:<id>            -> sell inventory item #id
//   market:page:<n>      -> market browse page n
//   market:buy:<id>      -> buy listing #id
//
// customId max length is 100 chars — our IDs are tiny, so we're safe.

const b = (id, label, style = ButtonStyle.Secondary, emoji) => {
  const btn = new ButtonBuilder().setCustomId(id).setLabel(label).setStyle(style);
  if (emoji) btn.setEmoji(emoji);
  return btn;
};

export const Btn = { b, ButtonStyle };

// Row helper that ignores empty slots.
export function row(...buttons) {
  return new ActionRowBuilder().addComponents(buttons.filter(Boolean));
}

// ── Reusable button rows ────────────────────────────────────────────

// Main navigation row shown under most screens (the "hub" bar).
export function navRow(active = '') {
  return row(
    b('case:open', 'Open Case', ButtonStyle.Primary, '📦'),
    b('nav:inventory', 'Inventory', active === 'inventory' ? ButtonStyle.Success : ButtonStyle.Secondary, '🎒'),
    b('nav:market', 'Market', active === 'market' ? ButtonStyle.Success : ButtonStyle.Secondary, '🛒'),
    b('nav:upgrade', 'Upgrades', active === 'upgrade' ? ButtonStyle.Success : ButtonStyle.Secondary, '🛠️'),
    b('nav:shack', 'Hub', active === 'shack' ? ButtonStyle.Success : ButtonStyle.Secondary, '🏠'),
  );
}

// Earn row: the quick income actions. (Open Case lives in navRow so it's on
// every screen — keeping it out of here avoids a duplicate customId when both
// rows render together.)
export function earnRow() {
  return row(
    b('daily:claim', 'Daily', ButtonStyle.Success, '💰'),
    b('invest:collect', 'Collect', ButtonStyle.Success, '🤖'),
  );
}

// Play row: the higher-risk fun actions + leaderboard (shown on the hub).
export function playRow() {
  return row(
    b('match:play', 'Play Match', ButtonStyle.Primary, '🔫'),
    b('nav:casino', 'Casino', ButtonStyle.Secondary, '🎰'),
    b('nav:leaderboard', 'Leaderboard', ButtonStyle.Secondary, '🏆'),
  );
}

// A per-item Sell button, used next to inventory entries.
export function sellButton(itemId) {
  return b(`sell:${itemId}`, 'Sell', ButtonStyle.Danger, '💸');
}

// A per-listing Buy button, used in market browse.
export function buyButton(listingId) {
  return b(`market:buy:${listingId}`, 'Buy', ButtonStyle.Success, '🛒');
}

// Market pagination row.
export function marketNav(page, totalPages) {
  return row(
    page > 1 ? b(`market:page:${page - 1}`, 'Prev', ButtonStyle.Secondary, '◀️') : null,
    page < totalPages ? b(`market:page:${page + 1}`, 'Next', ButtonStyle.Secondary, '▶️') : null,
    b('nav:listings', 'My Listings', ButtonStyle.Secondary, '🏷️'),
    b('nav:shack', 'Hub', ButtonStyle.Secondary, '🏠'),
  );
}
