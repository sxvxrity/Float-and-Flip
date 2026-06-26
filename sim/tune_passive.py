#!/usr/bin/env python3
"""Test different passive-income settings to find balance."""
import random

# Fixed constants (unchanged)
TRADEBOT_BASE = 500
DAILY_BASE = 500; DAILY_COOLDOWN_H = 20
CASE_COST = 250; AVG_SKIN_VALUE = 320
MATCH_MIN, MATCH_MAX = 200, 600; MATCH_COOLDOWN_H = 0.5
MATCH_WIN_CHANCE = 0.5; SKIN_DROP_CHANCE = 0.25
CASINO_EDGE = 0.05

def simulate(profile, rate, cap, days=7):
    coins = 1000; bots = 0
    src = {'daily':0,'bots':0,'match':0,'cases_net':0,'casino_net':0}
    last_daily=-999; last_match=-999; last_collect=0
    for h in range(days*24):
        hod = h%24
        if hod in profile['active_hours']:
            if h-last_daily >= DAILY_COOLDOWN_H:
                d=DAILY_BASE+random.randint(0,300); coins+=d; src['daily']+=d; last_daily=h
            if bots>0:
                acc=min(h-last_collect, cap)
                e=int(acc*bots*rate); coins+=e; src['bots']+=e; last_collect=h
            if h-last_match>=MATCH_COOLDOWN_H and random.random()<profile['match_prob']:
                last_match=h
                if random.random()<MATCH_WIN_CHANCE:
                    m=random.randint(MATCH_MIN,MATCH_MAX); coins+=m; src['match']+=m
                    if random.random()<SKIN_DROP_CHANCE: src['match']+=AVG_SKIN_VALUE
            if profile['buys_bots']:
                bc=TRADEBOT_BASE*(bots+1)
                while coins>bc*2 and bots<profile['max_bots']:
                    coins-=bc; bots+=1; bc=TRADEBOT_BASE*(bots+1)
            for _ in range(profile['cases_per_session']):
                if coins>CASE_COST: coins-=CASE_COST; src['cases_net']+=AVG_SKIN_VALUE-CASE_COST
            if profile['gambles']:
                bet=min(profile['bet_size'],coins//2)
                if bet>0: loss=int(bet*CASINO_EDGE); coins-=loss; src['casino_net']-=loss
    return coins, bots, src

PROFILES = {
    'Casual (no bots)': {'active_hours':[9,20],'match_prob':0.5,'buys_bots':False,'max_bots':0,'cases_per_session':1,'gambles':False,'bet_size':0},
    'Active (10 bots, plays all)': {'active_hours':[8,12,18,22],'match_prob':0.8,'buys_bots':True,'max_bots':10,'cases_per_session':2,'gambles':True,'bet_size':500},
    'Idle abuser (20 bots only)': {'active_hours':[9,21],'match_prob':0.0,'buys_bots':True,'max_bots':20,'cases_per_session':0,'gambles':False,'bet_size':0},
}

SETTINGS = [
    ("CURRENT: 120/hr, 24h cap", 120, 24),
    ("Option A: 50/hr, 12h cap", 50, 12),
    ("Option B: 60/hr, 8h cap", 60, 8),
    ("Option C: 40/hr, 12h cap", 40, 12),
]

for label, rate, cap in SETTINGS:
    print("="*64); print(label); print("="*64)
    for pname, prof in PROFILES.items():
        runs=[simulate(prof,rate,cap) for _ in range(300)]
        avg=sum(r[0] for r in runs)/len(runs)
        botinc=sum(r[2]['bots'] for r in runs)/len(runs)
        otherinc=sum(sum(v for k,v in r[2].items() if k!='bots') for r in runs)/len(runs)
        ratio = botinc/otherinc if otherinc>0 else 0
        print(f"  {pname:32} worth {avg:>9,.0f}  (bots {botinc:>8,.0f} vs other {otherinc:>7,.0f}, {ratio:.1f}x)")
    print()
