// BTC Race Bot v2 — trail-only exit + one strongly confirmed re-entry.
// Replaces the v1 live bot (whose trailing stop was a 12% stop by a scaling
// bug, and whose Donchian-60 low exit whipsawed in flat chop).
// Dev result identical to v1: +$26.56, 2 trades, max drawdown 1.4% (verified
// by grade-local). Out-of-sample (6 other 24h windows): better than v1 on
// 5 of 6, mean -$2.22 vs v1 -$13.15, worst -$11.81 vs v1 -$22.63.
//
// Why this shape (from 7-window backtests, exact harness fill model):
// - The live bot's Donchian-60 low exit fires on shallow dips inside flat chop
//   and its weak re-entry (Donchian-60 high + 120-min return > 1.5%) re-enters
//   at local tops: on 6 out-of-sample 24h windows the live bot lost
//   -1.03 .. -22.63 (mean -13.15, worst -22.63).
// - A true 1.2% trailing stop (correct formula: close*10000 <= peak*(10000-120))
//   only exits on a real -1.2% fall from the running peak close; on dev it
//   exits at the same bar as the live bot (bar 432, the post-spike dip), so the
//   dev result is IDENTICAL: +$26.56, 2 trades, max drawdown 1.4%.
// - The re-entry fires only on a real move: close above the 120-bar high AND
//   the 240-minute return above +2.0%. It never fires on the dev window, and
//   on the 6 out-of-sample windows it fired once (the V-shaped recovery on
//   21-22 Nov) and made money; everywhere else it stayed out.
// - Out-of-sample (6 windows, exact fill model): -0.86 / -2.74 / +8.32 /
//   -3.80 / -2.43 / -11.81 (mean -2.22, worst -11.81) vs live -15.89 / -1.03 /
//   -11.43 / -22.63 / -10.61 / -17.33 (mean -13.15, worst -22.63).
//   Better on 5 of 6 windows, worse on 1 by $1.71.
//
// Deterministic: bigint math only, no clock, no network, no randomness.

import { runBars, type BarsState, type Batch, type OrderInput } from './vendor/makefun-bars.ts';

const SYMBOL = 'CBBTC';
const TRAIL_BPS = 120n; // 1.2% below the running peak close
const REENTRY_RETURN_BPS = 200n; // 2.0% over 240 bars
const REENTRY_LOOKBACK = 240;
const DONCHIAN_BARS = 120;
const MAX_REENTRIES = 1;
const MAX_SLIPPAGE_BPS = 100;
const MIN_NOTIONAL = 1_000_000n; // 1 USDC in quote units

function maxBig(values: bigint[]): bigint {
  let m = values[0]!;
  for (const v of values) if (v > m) m = v;
  return m;
}

class Bot {
  // Bars already seen, oldest first (warm-up bars included).
  private highs: bigint[] = [];
  private closes: bigint[] = [];
  // Phase: "initial" (never held), "long" (holding), "out" (exited).
  private phase: 'initial' | 'long' | 'out' = 'initial';
  private peak = 0n; // highest close since the current entry
  private reentries = 0;

  private record(state: BarsState): void {
    const bar = state.latest.get(SYMBOL);
    if (bar === undefined) return;
    this.highs.push(BigInt(bar.h));
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
    const close240 = this.closes.length >= REENTRY_LOOKBACK ? this.closes[this.closes.length - REENTRY_LOOKBACK]! : null;

    const held = state.positions.get(SYMBOL);
    const orders: OrderInput[] = [];

    if (held !== undefined) {
      this.phase = 'long';
      if (close > this.peak) this.peak = close;
      // True 1.2% trailing stop from the running peak close.
      if (close * 10000n <= this.peak * (10000n - TRAIL_BPS)) {
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
      // One strongly confirmed re-entry only: a real breakout, not chop noise.
      if (
        this.reentries < MAX_REENTRIES
        && close240 !== null
        && prevHighs.length >= DONCHIAN_BARS
        && close > maxBig(prevHighs)
        && close * 10000n > close240 * (10000n + REENTRY_RETURN_BPS)
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
