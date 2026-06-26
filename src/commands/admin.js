import { SlashCommandBuilder, MessageFlags } from 'discord.js';
import { pool, getOrCreateUser } from '../lib/db.js';
import { rollSkin } from '../lib/skins.js';

// Only the user whose ID matches OWNER_ID (set in your environment variables)
// can use any of these. Everyone else is refused — even if the command shows
// up for them in Discord.
export const data = new SlashCommandBuilder()
  .setName('admin')
  .setDescription('Owner-only tools')
  .addSubcommand((s) =>
    s.setName('givecoins').setDescription('Give coins to a user')
      .addUserOption((o) => o.setName('user').setDescription('Who to give to').setRequired(true))
      .addIntegerOption((o) => o.setName('amount').setDescription('How many coins').setRequired(true)))
  .addSubcommand((s) =>
    s.setName('giveskin').setDescription('Give a random skin to a user')
      .addUserOption((o) => o.setName('user').setDescription('Who to give to').setRequired(true)))
  .addSubcommand((s) =>
    s.setName('setcoins').setDescription('Set a user\'s coin balance exactly')
      .addUserOption((o) => o.setName('user').setDescription('Whose balance').setRequired(true))
      .addIntegerOption((o) => o.setName('amount').setDescription('New balance').setRequired(true)));

export async function execute(interaction) {
  // Gatekeeper: refuse anyone who isn't the configured owner.
  if (interaction.user.id !== process.env.OWNER_ID) {
    return interaction.reply({ content: 'This command is owner-only.', flags: MessageFlags.Ephemeral });
  }

  const sub = interaction.options.getSubcommand();
  const target = interaction.options.getUser('user');
  await getOrCreateUser(target.id);

  if (sub === 'givecoins') {
    const amount = interaction.options.getInteger('amount');
    await pool.query('UPDATE users SET coins = coins + $1 WHERE user_id = $2', [amount, target.id]);
    return interaction.reply({
      content: `✅ Gave **${amount.toLocaleString()}** coins to ${target}.`,
      flags: MessageFlags.Ephemeral,
    });
  }

  if (sub === 'setcoins') {
    const amount = interaction.options.getInteger('amount');
    await pool.query('UPDATE users SET coins = $1 WHERE user_id = $2', [amount, target.id]);
    return interaction.reply({
      content: `✅ Set ${target}'s balance to **${amount.toLocaleString()}** coins.`,
      flags: MessageFlags.Ephemeral,
    });
  }

  if (sub === 'giveskin') {
    const drop = await rollSkin();
    await pool.query(
      `INSERT INTO inventory (user_id, skin_id, name, rarity, wear, stattrak, value, image)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [target.id, drop.skin_id, drop.name, drop.rarity, drop.wear, drop.stattrak, drop.value, drop.image]);
    return interaction.reply({
      content: `✅ Gave ${target} a **${drop.rarity}** ${drop.stattrak ? 'StatTrak™ ' : ''}${drop.name} (${drop.wear}).`,
      flags: MessageFlags.Ephemeral,
    });
  }
}
