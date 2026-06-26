import { Client, GatewayIntentBits, Collection } from 'discord.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import 'dotenv/config';
import { initDb } from './lib/db.js';
import { loadSkins } from './lib/skins.js';
import { startMarketSweeper } from './lib/sweeper.js';
import { checkCooldown } from './lib/cooldown.js';

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
client.once('ready', () => {
  console.log(`Logged in as ${client.user.tag}`);
});

client.on('interactionCreate', async (interaction) => {
  if (!interaction.isChatInputCommand()) return;
  const command = client.commands.get(interaction.commandName);
  if (!command) return;

  // Per-user rate limit on heavy commands to prevent DB hammering.
  const wait = checkCooldown(interaction.user.id, interaction.commandName);
  if (wait > 0) {
    return interaction.reply({
      content: `Slow down — try again in ${(wait / 1000).toFixed(1)}s.`,
      ephemeral: true,
    });
  }

  try {
    await command.execute(interaction);
  } catch (err) {
    console.error(err);
    const msg = { content: 'Something went wrong.', ephemeral: true };
    if (interaction.deferred || interaction.replied) {
      await interaction.followUp(msg);
    } else {
      await interaction.reply(msg);
    }
  }
});

// Boot: set up DB, warm the skin cache, then log in.
await initDb();
await loadSkins();
startMarketSweeper();
await client.login(process.env.DISCORD_TOKEN);
