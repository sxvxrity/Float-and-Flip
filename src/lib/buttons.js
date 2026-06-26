// Central button router. Every button's customId is "namespace:action[:arg]".
// We split it and dispatch to the matching action. Screen-changing buttons
// EDIT the existing message (interaction.update); one-off actions like a sale
// reply ephemerally so they don't clobber the shared screen.

import {
  hubScreen, openCase, claimDaily, collectIncome,
  inventoryScreen, sellItem, marketScreen, buyListing,
} from './actions.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function handleButton(interaction) {
  const [ns, action, arg] = interaction.customId.split(':');
  const userId = interaction.user.id;

  // ── Navigation: replace the current screen in place ──
  if (ns === 'nav') {
    const screen = await buildNav(action, userId);
    return interaction.update(screen);
  }

  // ── Open case: animate, then show result as a new screen ──
  if (ns === 'case' && action === 'open') {
    const res = await openCase(userId);
    if (res.error) return interaction.reply({ content: res.error, ephemeral: true });

    // Quick reveal: acknowledge by updating to an "opening" state, then result.
    await interaction.update({
      embeds: [{ color: 0x95a5a6, title: '🎁 Opening case…', description: '`⬜ 🟦 🟪 🟥 🟨`' }],
      components: [],
    });
    await sleep(1200);

    // Broadcast rare pulls to the channel (separate message, non-blocking).
    if (res.isRare) {
      interaction.channel?.send(`🎉 ${interaction.user} just unboxed a **${res.drop.rarity}**!`).catch(() => {});
    }
    return interaction.editReply(res.payload);
  }

  // ── Daily ──
  if (ns === 'daily' && action === 'claim') {
    const res = await claimDaily(userId);
    if (res.error) return interaction.reply({ content: res.error, ephemeral: true });
    return interaction.update(res.payload);
  }

  // ── Collect passive income ──
  if (ns === 'invest' && action === 'collect') {
    const res = await collectIncome(userId);
    if (res.error) return interaction.reply({ content: res.error, ephemeral: true });
    return interaction.update(res.payload);
  }

  // ── Sell an item: ephemeral confirmation, then refresh the inventory screen ──
  if (ns === 'sell') {
    const id = Number(action); // customId is "sell:<id>"
    const res = await sellItem(userId, id);
    if (res.error) return interaction.reply({ content: res.error, ephemeral: true });
    // Refresh the shared inventory message to reflect the sale...
    const screen = await inventoryScreen(userId);
    await interaction.update(screen);
    // ...and privately confirm the payout to the clicker.
    return interaction.followUp({ content: res.soldText, ephemeral: true });
  }

  // ── Market browse pagination ──
  if (ns === 'market' && action === 'page') {
    const screen = await marketScreen(userId, Number(arg));
    return interaction.update(screen);
  }

  // ── Market buy: ephemeral confirm, then refresh the market screen ──
  if (ns === 'market' && action === 'buy') {
    const res = await buyListing(userId, Number(arg));
    if (res.error) return interaction.reply({ content: res.error, ephemeral: true });
    const screen = await marketScreen(userId, 1);
    await interaction.update(screen);
    return interaction.followUp({ content: res.boughtText, ephemeral: true });
  }

  // Unknown button — acknowledge silently so it doesn't error.
  return interaction.deferUpdate().catch(() => {});
}

async function buildNav(action, userId) {
  if (action === 'inventory') return inventoryScreen(userId);
  if (action === 'market') return marketScreen(userId, 1);
  return hubScreen(userId); // 'shack' / default
}
