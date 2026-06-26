// Registers slash commands with Discord. Run once after changing commands:
//   npm run deploy
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

try {
  console.log(`Deploying ${commands.length} commands...`);
  // Guild-scoped deploy is instant — great for testing.
  // For global commands, swap to Routes.applicationCommands(CLIENT_ID).
  await rest.put(
    Routes.applicationGuildCommands(
      process.env.CLIENT_ID,
      process.env.GUILD_ID
    ),
    { body: commands }
  );
  console.log('Commands deployed.');
} catch (err) {
  console.error(err);
}
