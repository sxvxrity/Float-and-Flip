# CS2 Skin Shack — Discord idle bot (v1)

A CS2-themed skin-trading idle game. Real skin names/images from
ByMykel's CSGO-API, with a self-contained fictional coin economy.

## Commands
- `/case` — open a case (250 coins), pull a random skin by rarity + wear
- `/inventory` — see your skins, total value, balance, storage usage
- `/sell <id>` — sell a skin (market drift ±15%, minus your sell fee)
- `/tradeup <rarity>` — consume 10 skins of a rarity for 1 of the next tier up
- `/invest` — collect passive coins your trade bots earned while away
- `/daily` — claim a daily coin bonus (20h cooldown)
- `/upgrade tradebot|storage|fee|list` — spend coins to grow your operation
- `/leaderboard [sort]` — rank traders by inventory value (or coins)
- `/market browse|list|buy|unlist` — player-to-player skin trading
- `/settings fastmode` — skip the case-opening animation for instant pulls

Everyone starts with 1000 coins, 50 storage slots, and a 15% sell fee.

## Economy progression
- **Trade bots** earn 120 coins/hour each (passive), capped at 24h of offline
  accrual so you can't leave it for a week and bank a fortune. Collect via `/invest`.
- **Upgrade costs scale** with how many you already own, so the economy
  doesn't trivialise. Tune the constants at the top of `upgrade.js` / `passive.js`.
- **Trade-up** consumes your 10 *cheapest* skins of the chosen rarity, so it
  rewards bulk low-tier farming — the same logic as your real trade-up calculator.
- **Auto-buy floor:** each market listing gets a randomized lifespan
  (2–12h, rolled per listing). A background sweeper checks every 5 minutes
  and buys out expired listings, paying the seller 70% of the skin's
  **intrinsic value** (capped at the asking price) — *not* the asking price
  itself. This is deliberate: paying on asking price would let someone list a
  cheap skin for millions and farm the system. Paying on intrinsic value
  keeps the floor as a safety net, not an exploit. `/market browse` shows
  each listing's ⏳ time-left.

## Stack
- discord.js v14
- Postgres (use the Railway Postgres plugin)
- ByMykel CSGO-API for skin data (fetched once, cached to disk)

## Local setup
1. `npm install`
2. Copy `.env.example` to `.env` and fill in your token, IDs, and DATABASE_URL
3. `npm run deploy`   (registers slash commands to your test guild)
4. `npm start`

## Deploying on Railway
1. Push this repo to GitHub, create a Railway project from it
2. Add the **Postgres** plugin — it sets `DATABASE_URL` automatically
3. Add `DISCORD_TOKEN`, `CLIENT_ID`, `GUILD_ID` as variables
4. Set the start command to `npm start`
5. Run `npm run deploy` once (locally or as a one-off) to register commands

## How values work
Skin data (name, rarity, image) is real. Coin values are ours:
`base × wear multiplier × StatTrak multiplier × ECONOMY_MULT`.

**Values are computed LIVE, not frozen at drop time.** `/sell`, `/inventory`,
and `/leaderboard` all call `skinValue()` (or its SQL twin
`valueSqlExpression()`) in `src/lib/skins.js` — the single source of truth.
This means you can rebalance the whole economy at any time and it applies
retroactively to every skin already owned:

- Edit `RARITIES` / `WEAR_MULT` in `skins.js` to re-price specific tiers/wears.
- Set the `ECONOMY_MULT` env var (default 1.0) as a global inflation dial —
  e.g. `ECONOMY_MULT=0.8` instantly makes every skin worth 80%, pulling value
  out of a hot economy. No migration, no per-item update; it just recalculates.

The `value` column still exists on inventory rows but is now only a snapshot
for reference — the live functions ignore it when pricing.

## Next up (not built yet)
Case variety (unlock better case pools via a reputation stat), streak
bonuses on `/daily`, and a `/skin <id>` inspect command with a bigger image.

## Database migrations
`initDb()` runs `ADD COLUMN IF NOT EXISTS` / `CREATE TABLE IF NOT EXISTS`
on every boot, so deploying new versions over an existing Railway Postgres
won't wipe data or need manual SQL. The `fast_mode` column and
`market_listings` table are added automatically.

## Note: required intents
`/leaderboard` resolves user IDs to usernames, which needs the
**Server Members Intent**. Enable it in the Discord Developer Portal
under your app → Bot → Privileged Gateway Intents. It's already declared
in `index.js`.
