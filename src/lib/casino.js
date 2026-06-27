// Casino games. Each game's odds are documented inline. The house edge comes
// ONLY from payout ratios being slightly below true odds — every individual
// outcome is drawn fairly from fairrng.js. No per-play rigging.

import { EmbedBuilder, ButtonStyle } from 'discord.js';
import { rnd, weighted, chance, shuffledDeck } from './fairrng.js';
import { placeBet, settle } from './betting.js';
import { getOrCreateUser } from './db.js';
import { row, navRow, ownedFooter, Btn } from './components.js';

const b = Btn.b;

// ── CASINO HUB ──────────────────────────────────────────────────────
export async function casinoScreen(userId) {
  const user = await getOrCreateUser(userId);
  const embed = new EmbedBuilder().setColor(0x9b59b6)
    .setTitle('🎰 The Casino')
    .setDescription(
      `💰 **${user.coins.toLocaleString()}** coins\n\n` +
      'Pick a game below, then choose your bet.')
    .setFooter(ownedFooter(userId, 'Gamble responsibly — it\'s just coins, but still.'));

  const gameRow = row(
    b('cas:slots', 'Slots', ButtonStyle.Primary, '🎰'),
    b('cas:roulette', 'Roulette', ButtonStyle.Primary, '🎡'),
    b('cas:blackjack', 'Blackjack', ButtonStyle.Primary, '🃏'),
    b('cas:coinflip', 'Coinflip', ButtonStyle.Primary, '🪙'),
  );
  return { embeds: [embed], components: [gameRow, navRow('casino')] };
}

// Preset bet amounts offered as buttons (no typing needed).
const BET_PRESETS = [100, 500, 1000, 5000];

// A bet-picker screen for a given game. After picking a bet, the customId
// carries the game + amount so the handler knows what to play. For roulette
// and coinflip the bet picker leads to a CHOICE picker (red/black, heads/tails).
export function betPicker(game) {
  const labels = {
    slots: '🎰 Slots', roulette: '🎡 Roulette',
    blackjack: '🃏 Blackjack', coinflip: '🪙 Coinflip',
  };
  const embed = new EmbedBuilder().setColor(0x9b59b6)
    .setTitle(`${labels[game]} — pick your bet`)
    .setDescription('Choose a stake, or use the slash command for a custom amount.');
  const betRow = row(...BET_PRESETS.map((amt) =>
    b(`bet:${game}:${amt}`, amt.toLocaleString(), ButtonStyle.Success, '💰')));
  return { embeds: [embed], components: [betRow, row(
    b('nav:casino', 'Back', ButtonStyle.Secondary, '◀️'))] };
}

// For roulette: after a bet is chosen, pick a simple space (red/black/even/odd).
export function rouletteChoice(bet) {
  const embed = new EmbedBuilder().setColor(0x9b59b6)
    .setTitle(`🎡 Roulette — ${bet.toLocaleString()} coins`)
    .setDescription('Pick where to bet. (For a single number, use `/roulette`.)');
  const choiceRow = row(
    b(`play:roulette:${bet}:red`, 'Red', ButtonStyle.Danger, '🔴'),
    b(`play:roulette:${bet}:black`, 'Black', ButtonStyle.Secondary, '⚫'),
    b(`play:roulette:${bet}:even`, 'Even', ButtonStyle.Primary),
    b(`play:roulette:${bet}:odd`, 'Odd', ButtonStyle.Primary),
  );
  return { embeds: [embed], components: [choiceRow, row(
    b('nav:casino', 'Back', ButtonStyle.Secondary, '◀️'))] };
}

// For coinflip: after a bet, pick heads or tails.
export function coinflipChoice(bet) {
  const embed = new EmbedBuilder().setColor(0x9b59b6)
    .setTitle(`🪙 Coinflip — ${bet.toLocaleString()} coins`)
    .setDescription('Heads or tails?');
  const choiceRow = row(
    b(`play:coinflip:${bet}:heads`, 'Heads', ButtonStyle.Primary, '👑'),
    b(`play:coinflip:${bet}:tails`, 'Tails', ButtonStyle.Primary, '🪙'),
  );
  return { embeds: [embed], components: [choiceRow, row(
    b('nav:casino', 'Back', ButtonStyle.Secondary, '◀️'))] };
}

// ── SLOTS ───────────────────────────────────────────────────────────
// 3 reels. Symbols are weighted (cherries common, seven rare). Payouts are
// for THREE of a kind, plus a small payout for any two cherries. Tuned via
// simulation to ~90% RTP (≈10% house edge) — in line with real slot machines.
const SLOT_SYMBOLS = [
  { value: '🍒', weight: 30, three: 5 },
  { value: '🍋', weight: 25, three: 9 },
  { value: '🔔', weight: 18, three: 15 },
  { value: '💎', weight: 12, three: 30 },
  { value: '7️⃣', weight: 6,  three: 80 },
];

export async function playSlots(userId, bet) {
  const placed = await placeBet(userId, bet);
  if (placed.error) return { error: placed.error };

  const reels = [0, 1, 2].map(() => weighted(SLOT_SYMBOLS));
  let payout = 0, line = '';

  if (reels[0] === reels[1] && reels[1] === reels[2]) {
    // Three of a kind.
    const sym = SLOT_SYMBOLS.find((s) => s.value === reels[0]);
    payout = bet * sym.three;
    line = `Three ${reels[0]} — **${sym.three}×**!`;
  } else {
    // Any two cherries pays a small consolation.
    const cherries = reels.filter((r) => r === '🍒').length;
    if (cherries === 2) { payout = Math.floor(bet * 1.5); line = 'Two 🍒 — **1.5×**'; }
    else line = 'No win this time.';
  }

  const balance = await settle(userId, payout);
  const net = payout - bet;

  const embed = new EmbedBuilder()
    .setColor(payout > 0 ? 0x2ecc71 : 0xe74c3c)
    .setTitle('🎰 Slots')
    .setDescription(`${reels.join(' ┃ ')}\n\n${line}`)
    .addFields(
      { name: 'Bet', value: bet.toLocaleString(), inline: true },
      { name: net >= 0 ? 'Won' : 'Lost', value: `${Math.abs(net).toLocaleString()}`, inline: true },
      { name: 'Balance', value: balance.toLocaleString(), inline: true },
    );

  // Animation frames: reels lock left-to-right. Each frame shows already-locked
  // reels plus still-spinning random symbols for the rest.
  const spin = () => weighted(SLOT_SYMBOLS);
  const frame = (locked) => {
    const cells = [0, 1, 2].map((i) => (i < locked ? reels[i] : spin()));
    return { embeds: [{ color: 0x95a5a6, title: '🎰 Slots', description: `${cells.join(' ┃ ')}\n\n🎲 Spinning…` }] };
  };
  const animation = [frame(0), frame(1), frame(2)];

  return {
    animation,
    payload: { embeds: [embed], components: [row(
      b(`slots:again:${bet}`, `Spin again (${bet})`, ButtonStyle.Primary, '🎰')), navRow()] },
  };
}

// ── ROULETTE ────────────────────────────────────────────────────────
// European single-zero wheel: pockets 0-36 (37 total). The single zero is
// where the house edge lives (~2.7%). Bets: red/black (pays 1:1), even/odd
// (1:1), or a single number 0-36 (pays 35:1). True odds of a number are 1/37,
// paying 35:1 is the classic edge.
const RED = new Set([1,3,5,7,9,12,14,16,18,19,21,23,25,27,30,32,34,36]);

export async function playRoulette(userId, bet, betType) {
  const placed = await placeBet(userId, bet);
  if (placed.error) return { error: placed.error };

  const pocket = rnd(0, 36);
  const isRed = RED.has(pocket);
  const color = pocket === 0 ? 'green' : isRed ? 'red' : 'black';

  let won = false, multiplier = 0;
  const t = betType.toLowerCase();

  if (t === 'red')   { won = color === 'red';   multiplier = 2; }
  else if (t === 'black') { won = color === 'black'; multiplier = 2; }
  else if (t === 'even')  { won = pocket !== 0 && pocket % 2 === 0; multiplier = 2; }
  else if (t === 'odd')   { won = pocket % 2 === 1; multiplier = 2; }
  else {
    // A specific number 0-36.
    const num = Number(t);
    if (!Number.isInteger(num) || num < 0 || num > 36) {
      // Refund the bet — invalid input shouldn't cost coins.
      await settle(userId, bet);
      return { error: 'Bet on: red, black, even, odd, or a number 0-36.' };
    }
    won = pocket === num; multiplier = 36; // 35:1 + your stake back
  }

  const payout = won ? bet * multiplier : 0;
  const balance = await settle(userId, payout);
  const net = payout - bet;
  const emoji = color === 'red' ? '🔴' : color === 'black' ? '⚫' : '🟢';

  const embed = new EmbedBuilder()
    .setColor(won ? 0x2ecc71 : 0xe74c3c)
    .setTitle('🎡 Roulette')
    .setDescription(`The ball landed on ${emoji} **${pocket}** (${color}).\n\n${won ? '**You won!**' : 'No luck this time.'}`)
    .addFields(
      { name: 'Bet', value: `${bet.toLocaleString()} on ${t}`, inline: true },
      { name: net >= 0 ? 'Won' : 'Lost', value: Math.abs(net).toLocaleString(), inline: true },
      { name: 'Balance', value: balance.toLocaleString(), inline: true },
    );
  // Animation: the ball "bounces" through a few random pockets before settling.
  const bounce = () => {
    const p = rnd(0, 36);
    const c = p === 0 ? '🟢' : RED.has(p) ? '🔴' : '⚫';
    return { embeds: [{ color: 0x95a5a6, title: '🎡 Roulette', description: `🎱 The ball rattles around…\n\n${c} **${p}**` }] };
  };
  const animation = [bounce(), bounce(), bounce()];

  return {
    animation,
    payload: { embeds: [embed], components: [row(
      b(`roulette:again:${bet}:${t}`, `Bet again`, ButtonStyle.Primary, '🎡')), navRow()] },
  };
}

// ── COINFLIP ────────────────────────────────────────────────────────
// Heads/tails. To create a small house edge on a true 50/50, a win pays 1.95×
// instead of 2× (a 2.5% edge). Honest coin, slightly shaved payout.
export async function playCoinflip(userId, bet, side) {
  const placed = await placeBet(userId, bet);
  if (placed.error) return { error: placed.error };

  const s = side.toLowerCase();
  if (s !== 'heads' && s !== 'tails') {
    await settle(userId, bet); // refund
    return { error: 'Pick `heads` or `tails`.' };
  }
  const result = chance(0.5) ? 'heads' : 'tails';
  const won = result === s;
  const payout = won ? Math.floor(bet * 1.95) : 0;
  const balance = await settle(userId, payout);
  const net = payout - bet;

  const embed = new EmbedBuilder()
    .setColor(won ? 0x2ecc71 : 0xe74c3c)
    .setTitle('🪙 Coinflip')
    .setDescription(`It landed on **${result}** ${result === 'heads' ? '👑' : '🪙'}.\n\n${won ? '**You won!**' : 'You lost.'}`)
    .addFields(
      { name: 'Bet', value: `${bet.toLocaleString()} on ${s}`, inline: true },
      { name: net >= 0 ? 'Won' : 'Lost', value: Math.abs(net).toLocaleString(), inline: true },
      { name: 'Balance', value: balance.toLocaleString(), inline: true },
    );
  // Animation: the coin tumbles before landing.
  const animation = [
    { embeds: [{ color: 0x95a5a6, title: '🪙 Coinflip', description: '🪙 Flipping… 👑' }] },
    { embeds: [{ color: 0x95a5a6, title: '🪙 Coinflip', description: '🪙 Flipping… 🪙' }] },
    { embeds: [{ color: 0x95a5a6, title: '🪙 Coinflip', description: '🪙 Flipping… 👑' }] },
  ];

  return {
    animation,
    payload: { embeds: [embed], components: [row(
      b(`coinflip:again:${bet}:${s}`, 'Flip again', ButtonStyle.Primary, '🪙')), navRow()] },
  };
}

// ── BLACKJACK ───────────────────────────────────────────────────────
// Standard rules: blackjack pays 3:2, dealer stands on 17, player hits/stands.
// The house edge comes from the player acting first (bust = instant loss) and
// dealer winning ties on... no — we push on ties (fair). Edge ~1-2% from the
// bust-first rule. Game state is held IN MEMORY keyed by userId, since a hand
// is short-lived; it doesn't need DB persistence.

const HANDS = new Map(); // userId -> { deck, player, dealer, bet, startedAt }

// Abandoned hands (started but never finished) would linger forever, so sweep
// any older than 10 minutes. The bet was already taken at deal time, so the
// player simply forfeited it — we just free the memory.
setInterval(() => {
  const cutoff = Date.now() - 10 * 60 * 1000;
  for (const [uid, st] of HANDS) {
    if ((st.startedAt ?? 0) < cutoff) HANDS.delete(uid);
  }
}, 5 * 60 * 1000).unref?.();

function handValue(cards) {
  let total = 0, aces = 0;
  for (const c of cards) {
    if (c.rank === 'A') { total += 11; aces++; }
    else if (['K', 'Q', 'J'].includes(c.rank)) total += 10;
    else total += Number(c.rank);
  }
  while (total > 21 && aces > 0) { total -= 10; aces--; }
  return total;
}

const showCards = (cards) => cards.map((c) => `${c.rank}${c.suit}`).join(' ');

function bjEmbed(state, { reveal = false, title = '🃏 Blackjack', note = '', color = 0x9b59b6 } = {}) {
  const dealerCards = reveal ? state.dealer : [state.dealer[0], { rank: '?', suit: '' }];
  const dealerVal = reveal ? handValue(state.dealer) : handValue([state.dealer[0]]);
  return new EmbedBuilder().setColor(color).setTitle(title)
    .setDescription(
      `**Dealer** (${reveal ? dealerVal : '?'})\n${showCards(dealerCards)}\n\n` +
      `**You** (${handValue(state.player)})\n${showCards(state.player)}` +
      (note ? `\n\n${note}` : ''))
    .setFooter({ text: `Bet: ${state.bet.toLocaleString()} coins` });
}

const bjButtons = () => row(
  b('bj:hit', 'Hit', ButtonStyle.Success, '🎴'),
  b('bj:stand', 'Stand', ButtonStyle.Danger, '✋'),
);

export async function startBlackjack(userId, bet) {
  const placed = await placeBet(userId, bet);
  if (placed.error) return { error: placed.error };

  const deck = shuffledDeck();
  const player = [deck.pop(), deck.pop()];
  const dealer = [deck.pop(), deck.pop()];
  const state = { deck, player, dealer, bet, startedAt: Date.now() };
  HANDS.set(userId, state);

  // Immediate blackjack check.
  if (handValue(player) === 21) {
    return finishBlackjack(userId, state, 'player-bj');
  }
  const embed = bjEmbed(state, { note: 'Hit or stand?' });
  return { payload: { embeds: [embed], components: [bjButtons(), navRow()] } };
}

export async function blackjackHit(userId) {
  const state = HANDS.get(userId);
  if (!state) return { error: 'No active blackjack hand. Start one with `/blackjack <bet>`.' };
  state.player.push(state.deck.pop());

  if (handValue(state.player) > 21) {
    return finishBlackjack(userId, state, 'player-bust');
  }
  const embed = bjEmbed(state, { note: 'Hit or stand?' });
  return { payload: { embeds: [embed], components: [bjButtons(), navRow()] } };
}

export async function blackjackStand(userId) {
  const state = HANDS.get(userId);
  if (!state) return { error: 'No active blackjack hand. Start one with `/blackjack <bet>`.' };
  // Dealer draws to 17.
  while (handValue(state.dealer) < 17) state.dealer.push(state.deck.pop());
  return finishBlackjack(userId, state, 'showdown');
}

// Resolves a hand, pays out, and clears state. The FIRST line atomically
// claims the hand: if a concurrent hit/stand already settled it, HANDS no
// longer has it and we bail — preventing a double payout from rapid clicks.
async function finishBlackjack(userId, state, reason) {
  if (!HANDS.has(userId) || HANDS.get(userId) !== state) {
    // Already settled by a racing action — do nothing, pay nothing.
    return { error: 'That hand was already resolved.' };
  }
  HANDS.delete(userId); // claim it; no other call can now settle this state
  const pv = handValue(state.player), dv = handValue(state.dealer);
  let payout = 0, outcome = '';

  if (reason === 'player-bj') {
    // Player blackjack pays 3:2 (unless dealer also has 21 -> push).
    if (dv === 21) { payout = state.bet; outcome = 'Push — you both have 21.'; }
    else { payout = Math.floor(state.bet * 2.5); outcome = '**Blackjack!** Pays 3:2.'; }
  } else if (reason === 'player-bust') {
    payout = 0; outcome = '**Bust!** You went over 21.';
  } else {
    // Showdown.
    if (dv > 21) { payout = state.bet * 2; outcome = '**Dealer busts — you win!**'; }
    else if (pv > dv) { payout = state.bet * 2; outcome = '**You win!**'; }
    else if (pv < dv) { payout = 0; outcome = 'Dealer wins.'; }
    else { payout = state.bet; outcome = 'Push — it\'s a tie.'; }
  }

  const balance = await settle(userId, payout);
  const net = payout - state.bet;
  const embed = bjEmbed(state, {
    reveal: true,
    title: '🃏 Blackjack — Result',
    color: net > 0 ? 0x2ecc71 : net < 0 ? 0xe74c3c : 0xf1c40f,
    note: `${outcome}\n\n${net >= 0 ? 'Won' : 'Lost'} **${Math.abs(net).toLocaleString()}** · Balance **${balance.toLocaleString()}**`,
  });
  return { payload: { embeds: [embed], components: [row(
    b(`bj:again:${state.bet}`, `Deal again (${state.bet})`, ButtonStyle.Primary, '🃏')), navRow()] } };
}
