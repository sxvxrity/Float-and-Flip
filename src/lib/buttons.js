// Central button router. Every button's customId is "namespace:action[:arg]".
// We split it and dispatch to the matching action. Screen-changing buttons
// EDIT the existing message (interaction.update); transient notices use the
// self-deleting ephemeral helpers so they vanish after ~30s.

import {
  hubScreen, openCase, claimDaily, collectIncome,
  inventoryScreen, sellItem, marketScreen, buyListing,
  upgradeScreen, buyUpgrade, unlistListing, myListingsScreen,
} from './actions.js';
import {
  casinoScreen, playSlots, playRoulette, playCoinflip,
  startBlackjack, blackjackHit, blackjackStand,
} from './casino.js';
import { playMatch } from './match.js';
import { getOrCreateUser } from './db.js';
import { ephemeralReply, ephemeralFollowUp } from './ephemeral.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const FRAME_MS = 800;

// Plays a result that may include animation frames. If the user has fast_mode
// on, frames are skipped and the result shows instantly. The result.payload is
// always shown last via update/editReply.
async function playResult(interaction, userId, result) {
  if (result.error) return ephemeralReply(interaction, result.error);

  const user = await getOrCreateUser(userId);
  const frames = (!user.fast_mode && result.animation) ? result.animation : [];

  if (frames.length === 0) {
    // No animation — replace the screen in one go.
    return interaction.update(result.payload);
  }

  // Show frame 1 via update, then edit through the rest, then the final result.
  await interaction.update({ ...frames[0], components: [] });
  for (let i = 1; i < frames.length; i++) {
    await sleep(FRAME_MS);
    await interaction.editReply({ ...frames[i], components: [] });
  }
  await sleep(FRAME_MS);
  return interaction.editReply(result.payload);
}

export async function handleButton(interaction) {
  const [ns, action, arg] = interaction.customId.split(':');
  const userId = interaction.user.id;

  // ── Navigation: replace the current screen in place ──
  if (ns === 'nav') {
    const screen = await buildNav(action, userId);
    return interaction.update(screen);
  }

  // ── Open case: animate (unless fast mode), then show result ──
  if (ns === 'case' && action === 'open') {
    const res = await openCase(userId);
    if (res.error) return ephemeralReply(interaction, res.error);

    const user = await getOrCreateUser(userId);
    if (!user.fast_mode) {
      await interaction.update({
        embeds: [{ color: 0x95a5a6, title: '🎁 Opening case…', description: '`⬜ 🟦 🟪 🟥 🟨`' }],
        components: [],
      });
      await sleep(1200);
      if (res.isRare) {
        interaction.channel?.send(`🎉 ${interaction.user} just unboxed a **${res.drop.rarity}**!`).catch(() => {});
      }
      return interaction.editReply(res.payload);
    }
    // Fast mode: still broadcast rare, but skip the reveal.
    if (res.isRare) {
      interaction.channel?.send(`🎉 ${interaction.user} just unboxed a **${res.drop.rarity}**!`).catch(() => {});
    }
    return interaction.update(res.payload);
  }

  // ── Daily ──
  if (ns === 'daily' && action === 'claim') {
    const res = await claimDaily(userId);
    if (res.error) return ephemeralReply(interaction, res.error);
    return interaction.update(res.payload);
  }

  // ── Collect passive income ──
  if (ns === 'invest' && action === 'collect') {
    const res = await collectIncome(userId);
    if (res.error) return ephemeralReply(interaction, res.error);
    return interaction.update(res.payload);
  }

  // ── Sell an item: refresh the inventory screen, confirm privately ──
  if (ns === 'sell') {
    const id = Number(action);
    const res = await sellItem(userId, id);
    if (res.error) return ephemeralReply(interaction, res.error);
    const screen = await inventoryScreen(userId);
    await interaction.update(screen);
    return ephemeralFollowUp(interaction, res.soldText);
  }

  // ── Buy an upgrade ──
  if (ns === 'upgrade') {
    const res = await buyUpgrade(userId, action);
    if (res.error) return ephemeralReply(interaction, res.error);
    const screen = await upgradeScreen(userId);
    await interaction.update(screen);
    return ephemeralFollowUp(interaction, res.ok);
  }

  // ── Market browse pagination ──
  if (ns === 'market' && action === 'page') {
    const screen = await marketScreen(userId, Number(arg));
    return interaction.update(screen);
  }

  // ── Market buy ──
  if (ns === 'market' && action === 'buy') {
    const res = await buyListing(userId, Number(arg));
    if (res.error) return ephemeralReply(interaction, res.error);
    const screen = await marketScreen(userId, 1);
    await interaction.update(screen);
    return ephemeralFollowUp(interaction, res.boughtText);
  }

  // ── Market unlist ──
  if (ns === 'market' && action === 'unlist') {
    const res = await unlistListing(userId, Number(arg));
    if (res.error) return ephemeralReply(interaction, res.error);
    const screen = await myListingsScreen(userId);
    await interaction.update(screen);
    return ephemeralFollowUp(interaction, res.ok);
  }

  // ── Casino: slots / roulette / coinflip "play again" (animated) ──
  if (ns === 'slots' && action === 'again') {
    return playResult(interaction, userId, await playSlots(userId, Number(arg)));
  }
  if (ns === 'roulette' && action === 'again') {
    const parts = interaction.customId.split(':');
    return playResult(interaction, userId, await playRoulette(userId, Number(parts[2]), parts[3]));
  }
  if (ns === 'coinflip' && action === 'again') {
    const parts = interaction.customId.split(':');
    return playResult(interaction, userId, await playCoinflip(userId, Number(parts[2]), parts[3]));
  }

  // ── Blackjack: hit / stand / deal again ──
  // Hit/stand are instant (no reveal needed); "again" starts a fresh hand.
  if (ns === 'bj') {
    let res;
    if (action === 'hit') res = await blackjackHit(userId);
    else if (action === 'stand') res = await blackjackStand(userId);
    else if (action === 'again') res = await startBlackjack(userId, Number(arg));
    if (res.error) return ephemeralReply(interaction, res.error);
    return interaction.update(res.payload);
  }

  // ── Match (animated) ──
  if (ns === 'match' && action === 'play') {
    return playResult(interaction, userId, await playMatch(userId));
  }

  // Unknown button — acknowledge silently so it doesn't error.
  return interaction.deferUpdate().catch(() => {});
}

async function buildNav(action, userId) {
  if (action === 'inventory') return inventoryScreen(userId);
  if (action === 'market') return marketScreen(userId, 1);
  if (action === 'upgrade') return upgradeScreen(userId);
  if (action === 'listings') return myListingsScreen(userId);
  if (action === 'casino') return casinoScreen(userId);
  return hubScreen(userId);
}
