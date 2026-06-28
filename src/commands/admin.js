import { autoEphemeral } from '../lib/ephemeral.js';
import { SlashCommandBuilder, MessageFlags } from 'discord.js';
import { pool, getOrCreateUser } from '../lib/db.js';
import { rollSkin } from '../lib/skins.js';

export const data = new SlashCommandBuilder()
  .setName('admin')
  .setDescription('Owner-only tools')
  .addSubcommand((s) =>
    s.setName('givecoins').setDescription('Give coins to a user')
      .addUserOption((o) => o.setName('user').setDescription('Who to give to').setRequired(true))
      .addIntegerOption((o) => o.setName('amount').setDescription('How many coins').setRequired(true)))
  .addSubcommand((s) =>
    s.setName('setcoins').setDescription('Set a user\'s coin balance exactly')
      .addUserOption((o) => o.setName('user').setDescription('Whose balance').setRequired(true))
      .addIntegerOption((o) => o.setName('amount').setDescription('New balance').setRequired(true)))
  .addSubcommand((s) =>
    s.setName('giveskin').setDescription('Give a random skin to a user')
      .addUserOption((o) => o.setName('user').setDescription('Who to give to').setRequired(true)))
  .addSubcommand((s) =>
    s.setName('resetuser').setDescription('Wipe a user back to a fresh account')
      .addUserOption((o) => o.setName('user').setDescription('Who to reset').setRequired(true)))
  .addSubcommand((s) =>
    s.setName('resetall').setDescription('⚠️ Wipe the ENTIRE economy — all users, coins, skins')
      .addStringOption((o) => o.setName('confirm').setDescription('Type RESET to confirm').setRequired(true)));

export async function execute(interaction) {
  if (interaction.user.id !== process.env.OWNER_ID) {
    return autoEphemeral(interaction, 'This command is owner-only.');
  }

  const sub = interaction.options.getSubcommand();

  // ── Single-user commands ──
  if (['givecoins', 'setcoins', 'giveskin', 'resetuser'].includes(sub)) {
    const target = interaction.options.getUser('user');
    await getOrCreateUser(target.id);

    if (sub === 'givecoins') {
      const amount = interaction.options.getInteger('amount');
      await pool.query('UPDATE users SET coins = coins + $1 WHERE user_id = $2', [amount, target.id]);
      return autoEphemeral(interaction, `✅ Gave **${amount.toLocaleString()}** coins to ${target}.`);
    }

    if (sub === 'setcoins') {
      const amount = interaction.options.getInteger('amount');
      await pool.query('UPDATE users SET coins = $1 WHERE user_id = $2', [amount, target.id]);
      return autoEphemeral(interaction, `✅ Set ${target}'s balance to **${amount.toLocaleString()}** coins.`);
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

    if (sub === 'resetuser') {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await client.query('DELETE FROM inventory WHERE user_id = $1', [target.id]);
        await client.query('DELETE FROM market_listings WHERE seller_id = $1', [target.id]);
        await client.query(
          `UPDATE users SET
             coins = 1000, storage_cap = 50, sell_fee = 15,
             trade_bots = 0, upgrades = '{}', fast_mode = FALSE,
             last_passive = NOW(), last_daily = NULL, last_match = NULL, last_gift = NULL
           WHERE user_id = $1`, [target.id]);
        await client.query('COMMIT');
      } catch (e) { await client.query('ROLLBACK'); throw e; }
      finally { client.release(); }
      return interaction.reply({
        content: `✅ Reset ${target} to a fresh account — 1,000 coins, no skins, no bots, no upgrades.`,
        flags: MessageFlags.Ephemeral,
      });
    }
  }

  // ── Economy-wide reset ──
  if (sub === 'resetall') {
    const confirm = interaction.options.getString('confirm');
    if (confirm !== 'RESET') {
      return interaction.reply({
        content: '⚠️ Type exactly `RESET` in the confirm field to wipe the economy.',
        flags: MessageFlags.Ephemeral,
      });
    }
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('TRUNCATE TABLE inventory');
      await client.query('TRUNCATE TABLE market_listings');
      await client.query(
        `UPDATE users SET
           coins = 1000, storage_cap = 50, sell_fee = 15,
           trade_bots = 0, upgrades = '{}', fast_mode = FALSE,
           last_passive = NOW(), last_daily = NULL, last_match = NULL, last_gift = NULL`);
      await client.query('COMMIT');
    } catch (e) { await client.query('ROLLBACK'); throw e; }
    finally { client.release(); }
    return interaction.reply({
      content: `✅ Economy wiped. All users reset to 1,000 coins. Inventories and listings cleared.`,
      flags: MessageFlags.Ephemeral,
    });
  }
}
