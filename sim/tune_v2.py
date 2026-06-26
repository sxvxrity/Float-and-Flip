#!/usr/bin/env python3
"""Generous cap (no punishment for infrequent collection) + lower rate."""
import random
TRADEBOT_BASE=500; DAILY_BASE=500; DAILY_COOLDOWN_H=20
CASE_COST=250; AVG_SKIN_VALUE=320; MATCH_MIN,MATCH_MAX=200,600
MATCH_COOLDOWN_H=0.5; MATCH_WIN_CHANCE=0.5; SKIN_DROP_CHANCE=0.25; CASINO_EDGE=0.05

def sim(profile, rate, cap, days=7):
    coins=1000; bots=0
    src={'daily':0,'bots':0,'match':0,'cases_net':0,'casino_net':0}
    last_daily=-999; last_match=-999; last_collect=0
    for h in range(days*24):
        if h%24 in profile['active_hours']:
            if h-last_daily>=DAILY_COOLDOWN_H:
                d=DAILY_BASE+random.randint(0,300); coins+=d; src['daily']+=d; last_daily=h
            if bots>0:
                acc=min(h-last_collect,cap); e=int(acc*bots*rate)
                coins+=e; src['bots']+=e; last_collect=h
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
                if bet>0: coins-=int(bet*CASINO_EDGE); src['casino_net']-=int(bet*CASINO_EDGE)
    return coins,bots,src

P={
 'Casual no-bots (2x/day)':{'active_hours':[9,20],'match_prob':0.5,'buys_bots':False,'max_bots':0,'cases_per_session':1,'gambles':False,'bet_size':0},
 'Casual WITH a few bots (2x/day)':{'active_hours':[9,20],'match_prob':0.5,'buys_bots':True,'max_bots':5,'cases_per_session':1,'gambles':False,'bet_size':0},
 'Active (4x/day, 10 bots)':{'active_hours':[8,12,18,22],'match_prob':0.8,'buys_bots':True,'max_bots':10,'cases_per_session':2,'gambles':True,'bet_size':500},
 'Heavy bot user (2x/day, 20 bots)':{'active_hours':[9,21],'match_prob':0.2,'buys_bots':True,'max_bots':20,'cases_per_session':0,'gambles':False,'bet_size':0},
}
SET=[("CURRENT 120/hr,24h cap",120,24),("40/hr, 24h cap",40,24),("30/hr, 24h cap",30,24),("50/hr, 24h cap",50,24)]
for label,rate,cap in SET:
    print("="*68);print(label);print("="*68)
    res={}
    for pn,pr in P.items():
        runs=[sim(pr,rate,cap) for _ in range(300)]
        avg=sum(r[0] for r in runs)/len(runs)
        res[pn]=avg
        print(f"  {pn:34} net worth {avg:>9,.0f}")
    casual=res['Casual no-bots (2x/day)']
    heavy=res['Heavy bot user (2x/day, 20 bots)']
    print(f"  >> Heavy-bot vs casual-nobot gap: {heavy/casual:.1f}x\n")
