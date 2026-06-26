import pg from 'pg';
import 'dotenv/config';

const { Pool } = pg;

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  // Railway Postgres needs SSL in production
  ssl: process.env.DATABASE_URL?.includes('railway')
    ? { rejectUnauthorized: false }
    : false,
});

// Run once on startup to make sure tables exist.
export async function initDb() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      user_id     TEXT PRIMARY KEY,
      coins       BIGINT NOT NULL DEFAULT 1000,
      storage_cap INT    NOT NULL DEFAULT 50,
      sell_fee    INT    NOT NULL DEFAULT 15,   -- percent
      trade_bots  INT    NOT NULL DEFAULT 0,    -- passive coins/hour each
      upgrades    JSONB  NOT NULL DEFAULT '{}'::jsonb, -- {key: level} per upgrade
      fast_mode   BOOLEAN NOT NULL DEFAULT FALSE, -- skip case reveal animation
      last_passive TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      last_daily   TIMESTAMPTZ,
      last_match   TIMESTAMPTZ,
      created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS inventory (
      id          SERIAL PRIMARY KEY,
      user_id     TEXT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
      skin_id     TEXT NOT NULL,
      name        TEXT NOT NULL,
      rarity      TEXT NOT NULL,
      wear        TEXT NOT NULL,
      stattrak    BOOLEAN NOT NULL DEFAULT FALSE,
      value       BIGINT NOT NULL,             -- coin value at drop time
      image       TEXT,
      acquired_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE INDEX IF NOT EXISTS idx_inventory_user ON inventory(user_id);

    -- Player-to-player market. A listed skin is moved out of inventory
    -- into here, so it can't be sold or traded up while listed.
    CREATE TABLE IF NOT EXISTS market_listings (
      listing_id  SERIAL PRIMARY KEY,
      seller_id   TEXT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
      skin_id     TEXT NOT NULL,
      name        TEXT NOT NULL,
      rarity      TEXT NOT NULL,
      wear        TEXT NOT NULL,
      stattrak    BOOLEAN NOT NULL DEFAULT FALSE,
      price       BIGINT NOT NULL,
      base_value  BIGINT NOT NULL DEFAULT 0,  -- the skin's intrinsic value, for the auto-buy floor
      image       TEXT,
      listed_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      expires_at  TIMESTAMPTZ NOT NULL DEFAULT NOW() + INTERVAL '24 hours'
    );
    CREATE INDEX IF NOT EXISTS idx_market_price ON market_listings(price);
  `);

  // Migrations for databases created before a column existed.
  // ADD COLUMN IF NOT EXISTS is idempotent, so this is safe to run every boot.
  await pool.query(`
    ALTER TABLE users ADD COLUMN IF NOT EXISTS fast_mode BOOLEAN NOT NULL DEFAULT FALSE;
    ALTER TABLE market_listings ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ NOT NULL DEFAULT NOW() + INTERVAL '24 hours';
    ALTER TABLE market_listings ADD COLUMN IF NOT EXISTS base_value BIGINT NOT NULL DEFAULT 0;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS last_match TIMESTAMPTZ;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS upgrades JSONB NOT NULL DEFAULT '{}'::jsonb;
  `);
}

// Fetch a user, creating them with starter coins if they don't exist.
export async function getOrCreateUser(userId) {
  const { rows } = await pool.query(
    `INSERT INTO users (user_id) VALUES ($1)
     ON CONFLICT (user_id) DO UPDATE SET user_id = EXCLUDED.user_id
     RETURNING *`,
    [userId]
  );
  return rows[0];
}
