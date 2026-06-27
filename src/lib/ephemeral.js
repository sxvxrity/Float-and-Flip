// Sends an ephemeral ("only you can see this") reply that auto-deletes after a
// delay, so these transient notices don't pile up in the user's view.
//
// Note on ephemeral deletion: the bot can't "delete" an ephemeral message the
// normal way, but it CAN call interaction.deleteReply() on the interaction that
// created it. We schedule that on a timer. If the user dismisses it first, the
// delete throws harmlessly and we swallow the error.

import { MessageFlags } from 'discord.js';

const AUTO_DELETE_MS = 30_000;

// Reply ephemerally and schedule deletion. Use for transient notices
// (errors, confirmations) — NOT for the main game screens.
export async function ephemeralReply(interaction, content) {
  await interaction.reply({ content, flags: MessageFlags.Ephemeral });
  scheduleDelete(interaction);
}

// Same, but for when the interaction was already replied/deferred and we need
// a follow-up (e.g. after an .update() on the shared screen).
export async function ephemeralFollowUp(interaction, content) {
  const msg = await interaction.followUp({ content, flags: MessageFlags.Ephemeral });
  // Follow-ups are deleted by their own id, not deleteReply.
  setTimeout(() => {
    interaction.webhook.deleteMessage(msg.id).catch(() => {});
  }, AUTO_DELETE_MS);
}

function scheduleDelete(interaction) {
  setTimeout(() => {
    interaction.deleteReply().catch(() => {});
  }, AUTO_DELETE_MS);
}

// For slash commands that need a quick error reply that auto-deletes.
// Shorter delay (10s) since errors are quick reads.
export async function autoEphemeral(interaction, content) {
  await interaction.reply({ content, flags: MessageFlags.Ephemeral });
  setTimeout(() => interaction.deleteReply().catch(() => {}), 10_000);
}

// Plays an animated result for a SLASH COMMAND (first response). Defers, shows
// each frame via editReply, then the final payload. Respects fast mode (caller
// passes fast=true to skip frames). result = { animation?, payload, error? }.
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const FRAME_MS = 800;

export async function playSlashResult(interaction, result, fast) {
  if (result.error) {
    return interaction.reply({ content: result.error, flags: MessageFlags.Ephemeral })
      .then(() => scheduleDelete(interaction));
  }
  const frames = (!fast && result.animation) ? result.animation : [];
  if (frames.length === 0) {
    return interaction.reply(result.payload);
  }
  await interaction.reply({ ...frames[0], components: [] });
  for (let i = 1; i < frames.length; i++) {
    await sleep(FRAME_MS);
    await interaction.editReply({ ...frames[i], components: [] });
  }
  await sleep(FRAME_MS);
  return interaction.editReply(result.payload);
}
