// Registers slash commands with Discord.
//   npm run deploy            -> GLOBAL (every server the bot is in; ~1h to appear)
//   npm run deploy -- guild   -> just your test guild (instant, for development)
import { REST, Routes } from 'discord.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import 'dotenv/config';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const commands = [];
const commandsDir = path.join(__dirname, 'commands');
for (const file of fs.readdirSync(commandsDir).filter((f) => f.endsWith('.js'))) {
  const command = await import(`./commands/${file}`);
  if (command.data) commands.push(command.data.toJSON());
}

const rest = new REST().setToken(process.env.DISCORD_TOKEN);
const guildMode = process.argv.includes('guild');

try {
  if (guildMode) {
    console.log(`Deploying ${commands.length} commands to test guild (instant)...`);
    await rest.put(
      Routes.applicationGuildCommands(process.env.CLIENT_ID, process.env.GUILD_ID),
      { body: commands }
    );
  } else {
    console.log(`Deploying ${commands.length} commands GLOBALLY (can take up to 1 hour to appear)...`);
    await rest.put(
      Routes.applicationCommands(process.env.CLIENT_ID),
      { body: commands }
    );
  }
  console.log('Commands deployed.');
} catch (err) {
  console.error(err);
}

