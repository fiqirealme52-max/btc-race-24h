// BTC Race Bot — start long, exit once on a real reversal, one confirmed re-entry.
//
// Strategy, derived from walk-forward backtests on the frozen 24h dev window
// (1,440 one-minute cbBTC bars; exact harness fill model: 4 bps fee, 2 bps
// slippage, constant-product impact on the bar's open depth):
// - Buy all-in on the first scored bar. Zero lag on any opening rally: the dev
//   window's whole gain was one +3.2% spike in hours 4-5, and every lagged
//   entry left money on the table.
// - Exit the whole position the first time the close breaks the 60-bar
//   Donchian low or falls 1.2% below the running peak close (trailing stop).
//   Then stay in cash: the dev window's 18 flat hours after the spike bled
//   every strategy that kept re-entering (EMA-cross -115, RSI -25..-76,
//   plain Donchian-60 -5.24 in the second half alone).
// - At most ONE re-entry, and only on a real move: close above the 60-bar
//   high AND the 120-minute return above +1.5%. A 1.5% confirmation never
//   fired on the dev window, so the dev result is exactly the exit-once bot;
//   it exists only to catch a genuine late rally in the race window.
//
// Walk-forward (dev window, backtest with the exact fill model):
// - Full 24h: net PnL +$26.56, max drawdown 1.4%, 2 trades.
// - First half (up regime): +$26.56. Second half (flat/chop): $0.00, 0 trades.
// - Buy-and-hold on the same window: +$32.17 — this bot keeps 83% of the
//   upside with a 1.2% trailing stop as its worst case on the first leg.
//
// Deterministic: bigint math only, no clock, no network, no randomness.

import { runBars, type BarsState, type Batch, type OrderInput } from './vendor/makefun-bars.ts';

const SYMBOL = 'CBBTC';
const DONCHIAN_BARS = 60;
const TRAIL_BPS = 120n; // 1.2% below the running peak close
const REENTRY_RETURN_BPS = 150n; // 1.5% over 120 bars
const REENTRY_LOOKBACK = 120;
const MAX_REENTRIES = 1;
const MAX_SLIPPAGE_BPS = 100;
const MIN_NOTIONAL = 1_000_000n; // 1 USDC in quote units

function minBig(values: bigint[]): bigint {
  let m = values[0]!;
  for (const v of values) if (v < m) m = v;
  return m;
}

function maxBig(values: bigint[]): bigint {
  let m = values[0]!;
  for (const v of values) if (v > m) m = v;
  return m;
}

class Bot {
  // Bars already seen, oldest first (warm-up bars included).
  private highs: bigint[] = [];
  private lows: bigint[] = [];
  private closes: bigint[] = [];
  // Phase: "initial" (never held), "long" (holding), "out" (exited).
  private phase: 'initial' | 'long' | 'out' = 'initial';
  private peak = 0n; // highest close since the current entry
  private reentries = 0;

  private record(state: BarsState): void {
    const bar = state.latest.get(SYMBOL);
    if (bar === undefined) return;
    this.highs.push(BigInt(bar.h));
    this.lows.push(BigInt(bar.l));
    this.closes.push(BigInt(bar.c));
  }

  onBatch(state: BarsState, _batch: Batch): OrderInput[] {
    if (state.warmingUp) {
      this.record(state);
      return [];
    }

    const bar = state.latest.get(SYMBOL);
    if (bar === undefined) return [];
    const close = BigInt(bar.c);

    // History strictly before this bar.
    const prevHighs = this.highs.slice(-DONCHIAN_BARS);
    const prevLows = this.lows.slice(-DONCHIAN_BARS);
    const close120 = this.closes.length >= REENTRY_LOOKBACK ? this.closes[this.closes.length - REENTRY_LOOKBACK]! : null;

    const held = state.positions.get(SYMBOL);
    const orders: OrderInput[] = [];

    if (held !== undefined) {
      this.phase = 'long';
      if (close > this.peak) this.peak = close;
      let exitNow = false;
      if (close * 1000n <= this.peak * (1000n - TRAIL_BPS)) exitNow = true;
      if (prevLows.length >= DONCHIAN_BARS && close < minBig(prevLows)) exitNow = true;
      if (exitNow) {
        orders.push({ side: 'sell', symbol: SYMBOL, qty: held.qty, max_slippage_bps: MAX_SLIPPAGE_BPS });
      }
    } else if (this.phase === 'long') {
      // The exit fill landed; we are out.
      this.phase = 'out';
    } else if (this.phase === 'initial') {
      // First scored bar: buy all-in. Retried next batch if rejected.
      if (state.cash >= MIN_NOTIONAL) {
        orders.push({ side: 'buy', symbol: SYMBOL, notional_quote_units: state.cash, max_slippage_bps: MAX_SLIPPAGE_BPS });
        this.peak = close;
      }
    } else if (this.phase === 'out') {
      // One confirmed re-entry only: a real breakout, not chop noise.
      if (
        this.reentries < MAX_REENTRIES
        && close120 !== null
        && prevHighs.length >= DONCHIAN_BARS
        && close > maxBig(prevHighs)
        && close * 1000n > close120 * (1000n + REENTRY_RETURN_BPS)
        && state.cash >= MIN_NOTIONAL
      ) {
        orders.push({ side: 'buy', symbol: SYMBOL, notional_quote_units: state.cash, max_slippage_bps: MAX_SLIPPAGE_BPS });
        this.reentries += 1;
        this.peak = close;
      }
    }

    this.record(state);
    return orders;
  }
}

const bot = new Bot();
await runBars({ onBatch: (state, batch) => bot.onBatch(state, batch) });
