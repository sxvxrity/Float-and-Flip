import { Client, GatewayIntentBits, Collection, MessageFlags } from 'discord.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import 'dotenv/config';
import { initDb } from './lib/db.js';
import { loadSkins } from './lib/skins.js';
import { startMarketSweeper } from './lib/sweeper.js';
import { checkCooldown } from './lib/cooldown.js';
import { handleButton } from './lib/buttons.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// GuildMembers lets the leaderboard resolve user IDs to usernames.
// Enable the "Server Members Intent" toggle in the Discord Developer Portal.
const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers],
});
client.commands = new Collection();

// Load all command modules from src/commands.
const commandsDir = path.join(__dirname, 'commands');
for (const file of fs.readdirSync(commandsDir).filter((f) => f.endsWith('.js'))) {
  const command = await import(`./commands/${file}`);
  if (command.data && command.execute) {
    client.commands.set(command.data.name, command);
  }
}

// discord.js v14 uses the 'ready' event. (v15 renames it to 'clientReady'.)
// This discord.js build emits 'clientReady' (the v15-style name).
client.once('clientReady', () => {
  console.log(`Logged in as ${client.user.tag}`);
});

client.on('interactionCreate', async (interaction) => {
  // Button clicks go to their own handler.
  if (interaction.isButton()) {
    const wait = checkCooldown(interaction.user.id, 'button');
    if (wait > 0) {
      await interaction.reply({ content: `Slow down — try again in ${(wait / 1000).toFixed(1)}s.`, flags: MessageFlags.Ephemeral });
      setTimeout(() => interaction.deleteReply().catch(() => {}), 5000);
      return;
    }
    try {
      await handleButton(interaction);
    } catch (err) {
      console.error(err);
      const msg = { content: 'Something went wrong.', flags: MessageFlags.Ephemeral };
      if (interaction.deferred || interaction.replied) await interaction.followUp(msg).catch(() => {});
      else await interaction.reply(msg).catch(() => {});
    }
    return;
  }

  if (!interaction.isChatInputCommand()) return;
  const command = client.commands.get(interaction.commandName);
  if (!command) return;

  // Per-user rate limit on heavy commands to prevent DB hammering.
  const wait = checkCooldown(interaction.user.id, interaction.commandName);
  if (wait > 0) {
    await interaction.reply({
      content: `Slow down — try again in ${(wait / 1000).toFixed(1)}s.`,
      flags: MessageFlags.Ephemeral,
    });
    setTimeout(() => interaction.deleteReply().catch(() => {}), 5000);
    return;
  }

  try {
    await command.execute(interaction);
  } catch (err) {
    console.error(err);
    const msg = { content: 'Something went wrong.', flags: MessageFlags.Ephemeral };
    if (interaction.deferred || interaction.replied) {
      await interaction.followUp(msg);
    } else {
      await interaction.reply(msg);
    }
  }
});

// Boot: set up DB, log in, and warm the skin cache. The skin load is wrapped
// so a temporary CSGO-API outage logs a warning and retries in the background
// instead of crash-looping the whole bot. Commands that need skins (/case,
// /tradeup) call loadSkins() again on use, so they recover automatically once
// the data is available.
await initDb();
startMarketSweeper();

async function warmSkins(attempt = 1) {
  try {
    await loadSkins();
    console.log('Skin data loaded.');
  } catch (err) {
    const delay = Math.min(attempt * 30, 300); // back off, cap at 5 min
    console.warn(`Skin data load failed (attempt ${attempt}): ${err.message}. Retrying in ${delay}s.`);
    setTimeout(() => warmSkins(attempt + 1), delay * 1000);
  }
}
warmSkins();

await client.login(process.env.DISCORD_TOKEN);
