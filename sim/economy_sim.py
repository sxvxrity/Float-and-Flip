#!/usr/bin/env python3
"""
Float & Flip economy simulation — models a typical player over 7 days to find
income imbalances BEFORE launch. Uses the actual constants from the codebase.

Run: python3 sim/economy_sim.py
"""
import random

# ── Actual constants from the code (keep in sync) ──
COINS_PER_BOT_PER_HOUR = 120
MAX_ACCRUAL_HOURS = 24
TRADEBOT_BASE = 500          # cost = base * (owned+1): 500, 1000, 1500...
BOT_EFFICIENCY_PER_LVL = 0.10
DAILY_BASE = 500             # + random 0-300 + 150/daily_boost_level
DAILY_COOLDOWN_H = 20
CASE_COST = 250
MATCH_MIN, MATCH_MAX = 200, 600
MATCH_COOLDOWN_H = 0.5
MATCH_WIN_CHANCE = 0.5
SKIN_DROP_CHANCE = 0.25      # on a match win
# Average skin value from a case/match drop (rough, from rarity*wear weights):
AVG_SKIN_VALUE = 320         # weighted avg of a typical pull

# Casino: ~5% avg house edge across games — a player betting loses ~5% over time
CASINO_EDGE = 0.05

def simulate(profile, days=7):
    """profile: dict describing how the player behaves."""
    coins = 1000  # starting balance
    bots = 0
    bot_eff_lvl = 0
    coins_from = {'daily': 0, 'bots': 0, 'match': 0, 'cases_net': 0, 'casino_net': 0}
    last_daily_h = -999
    last_match_h = -999
    last_bot_collect_h = 0

    # Simulate hour by hour over the week.
    for h in range(days * 24):
        # Is the player "online" this hour? (active_hours = list of hours/day they play)
        hour_of_day = h % 24
        online = hour_of_day in profile['active_hours']

        if online:
            # DAILY
            if h - last_daily_h >= DAILY_COOLDOWN_H:
                d = DAILY_BASE + random.randint(0, 300)
                coins += d; coins_from['daily'] += d; last_daily_h = h

            # COLLECT BOT INCOME
            if bots > 0:
                hours_accrued = min(h - last_bot_collect_h, MAX_ACCRUAL_HOURS)
                rate = COINS_PER_BOT_PER_HOUR * (1 + BOT_EFFICIENCY_PER_LVL * bot_eff_lvl)
                earned = int(hours_accrued * bots * rate)
                coins += earned; coins_from['bots'] += earned; last_bot_collect_h = h

            # MATCH (if off cooldown and they bother)
            if h - last_match_h >= MATCH_COOLDOWN_H and random.random() < profile['match_prob']:
                last_match_h = h
                if random.random() < MATCH_WIN_CHANCE:
                    m = random.randint(MATCH_MIN, MATCH_MAX)
                    coins += m; coins_from['match'] += m
                    if random.random() < SKIN_DROP_CHANCE:
                        coins_from['match'] += AVG_SKIN_VALUE  # skin counts as value

            # BUY BOTS (reinvest if they have spare coins and want to)
            if profile['buys_bots']:
                bot_cost = TRADEBOT_BASE * (bots + 1)
                while coins > bot_cost * 2 and bots < profile['max_bots']:  # keep a buffer
                    coins -= bot_cost; bots += 1
                    bot_cost = TRADEBOT_BASE * (bots + 1)

            # OPEN CASES (cost coins, get a skin of avg value -> usually a small loss)
            for _ in range(profile['cases_per_session']):
                if coins > CASE_COST:
                    coins -= CASE_COST
                    coins_from['cases_net'] -= CASE_COST
                    coins_from['cases_net'] += AVG_SKIN_VALUE  # skin value gained

            # CASINO (bet a chunk, lose the house edge on average)
            if profile['gambles']:
                bet = min(profile['bet_size'], coins // 2)
                if bet > 0:
                    loss = int(bet * CASINO_EDGE)
                    coins -= loss; coins_from['casino_net'] -= loss

    return coins, bots, coins_from

PROFILES = {
    'Casual (logs in 2x/day, no bots)': {
        'active_hours': [9, 20], 'match_prob': 0.5, 'buys_bots': False,
        'max_bots': 0, 'cases_per_session': 1, 'gambles': False, 'bet_size': 0,
    },
    'Active (4x/day, buys bots, plays all)': {
        'active_hours': [8, 12, 18, 22], 'match_prob': 0.8, 'buys_bots': True,
        'max_bots': 10, 'cases_per_session': 2, 'gambles': True, 'bet_size': 500,
    },
    'Idle abuser (logs in 2x/day, MAX bots only)': {
        'active_hours': [9, 21], 'match_prob': 0.0, 'buys_bots': True,
        'max_bots': 20, 'cases_per_session': 0, 'gambles': False, 'bet_size': 0,
    },
    'Gambler (online lots, bets big)': {
        'active_hours': [10, 14, 18, 20, 23], 'match_prob': 0.3, 'buys_bots': False,
        'max_bots': 0, 'cases_per_session': 0, 'gambles': True, 'bet_size': 2000,
    },
}

print("=" * 70)
print("FLOAT & FLIP — 7-day economy simulation (avg of 200 runs each)")
print("=" * 70)
for name, prof in PROFILES.items():
    runs = [simulate(prof) for _ in range(200)]
    avg_coins = sum(r[0] for r in runs) / len(runs)
    avg_bots = sum(r[1] for r in runs) / len(runs)
    # average source breakdown
    src = {}
    for _, _, cf in runs:
        for k, v in cf.items():
            src[k] = src.get(k, 0) + v
    src = {k: v / len(runs) for k, v in src.items()}
    print(f"\n{name}")
    print(f"  Net worth after 7 days: {avg_coins:,.0f} coins (+ {avg_bots:.0f} bots)")
    print(f"  Income by source:")
    for k, v in sorted(src.items(), key=lambda x: -abs(x[1])):
        print(f"    {k:14} {v:>+12,.0f}")
