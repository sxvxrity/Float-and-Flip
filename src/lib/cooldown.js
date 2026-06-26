// Simple in-memory per-user, per-command cooldown. Stops one user from
// hammering the DB with rapid-fire commands (e.g. scripted /case spam).
// In-memory is fine: cooldowns are short and don't need to survive a restart.

// command name -> cooldown in milliseconds. Commands not listed have none.
const COOLDOWNS = {
  case: 2000,
  tradeup: 2000,
  sell: 1000,
  market: 1000,
  invest: 3000,
  daily: 3000,
};

// Map of "userId:command" -> timestamp when the cooldown expires.
const hits = new Map();

// Returns 0 if allowed, or milliseconds remaining if still cooling down.
export function checkCooldown(userId, command) {
  const ms = COOLDOWNS[command];
  if (!ms) return 0;

  const key = `${userId}:${command}`;
  const now = Date.now();
  const expires = hits.get(key) ?? 0;

  if (now < expires) return expires - now;

  hits.set(key, now + ms);
  return 0;
}

// Periodically clear stale entries so the map doesn't grow forever.
setInterval(() => {
  const now = Date.now();
  for (const [key, expires] of hits) {
    if (expires <= now) hits.delete(key);
  }
}, 60_000).unref?.();
