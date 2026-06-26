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

// Main navigation bar — pure navigation, all neutral grey EXCEPT the screen
// you're currently on, which is highlighted blurple so you always know where
// you are. No actions live here; those go in the action rows above it.
export function navRow(active = '') {
  const nav = (id, label, emoji, key) =>
    b(id, label, active === key ? ButtonStyle.Primary : ButtonStyle.Secondary, emoji);
  return row(
    nav('nav:shack', 'Hub', '🏠', 'shack'),
    nav('nav:inventory', 'Inventory', '🎒', 'inventory'),
    nav('nav:market', 'Market', '🛒', 'market'),
    nav('nav:upgrade', 'Upgrades', '🛠️', 'upgrade'),
    nav('nav:casino', 'Casino', '🎰', 'casino'),
  );
}

// Primary action row for the hub: the things you DO to earn. Green = money in,
// blurple = the headline action (opening a case).
export function earnRow() {
  return row(
    b('case:open', 'Open Case', ButtonStyle.Primary, '📦'),
    b('daily:claim', 'Daily', ButtonStyle.Success, '💰'),
    b('invest:collect', 'Collect', ButtonStyle.Success, '🤖'),
  );
}

// Secondary action row for the hub: play a match, view rankings.
export function playRow() {
  return row(
    b('match:play', 'Play Match', ButtonStyle.Primary, '🔫'),
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
