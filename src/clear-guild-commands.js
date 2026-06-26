// Run once to wipe guild-scoped commands that are showing as duplicates.
// After this, only the global commands remain.
//   node src/clear-guild-commands.js
import { REST, Routes } from 'discord.js';
import 'dotenv/config';

const rest = new REST().setToken(process.env.DISCORD_TOKEN);

try {
  await rest.put(
    Routes.applicationGuildCommands(process.env.CLIENT_ID, process.env.GUILD_ID),
    { body: [] } // empty array = delete all guild commands
  );
  console.log('✅ Guild commands cleared. Only global commands remain.');
  console.log('   (Global commands can take up to 1hr to fully propagate.)');
} catch (err) {
  console.error(err);
}
