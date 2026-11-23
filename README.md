# BTC Race Bot — 24h

[![BTC Race Bot](https://make.fun/badge/btc-race-24h-20261123-0511.svg)](https://make.fun/bounty/btc-race-24h-20261123-0511?utm_source=github&utm_medium=readme&utm_campaign=btc-race-24h-20261123-0511)
[![BTC Race Bot rank](https://make.fun/badge/btc-race-24h-20261123-0511/fiqirealme52-max/btc-race-24h/rank.svg)](https://make.fun/bounty/btc-race-24h-20261123-0511?utm_source=github&utm_medium=readme&utm_campaign=btc-race-24h-20261123-0511)
[![BTC Race Bot reward](https://make.fun/badge/btc-race-24h-20261123-0511/fiqirealme52-max/btc-race-24h/reward.svg)](https://make.fun/bounty/btc-race-24h-20261123-0511?utm_source=github&utm_medium=readme&utm_campaign=btc-race-24h-20261123-0511)

A bot that trades Coinbase Wrapped BTC (cbBTC) minute by minute on 1-minute
on-chain bars, for the [make.fun BTC race](https://make.fun/bounty/btc-race-24h-20261123-0511).
Simulation only: $1,000 of paper money, no real money is traded.

## Strategy

- **Buy all-in on the first scored bar** — zero lag on any opening rally.
- **Exit once** when the close breaks the 60-bar Donchian low or falls 1.2%
  below the running peak close (trailing stop). Then stay in cash: the dev
  window's 18 flat hours after its one spike bled every strategy that kept
  re-entering.
- **At most one re-entry**, only on a real move: close above the 60-bar high
  **and** the 120-minute return above +1.5%.

## Dev-window result (exact grader, `grade-local`)

- Net PnL **+$26.56** on the frozen 24h dev window (gate: > $0)
- Max drawdown **1.4%** (cap: 25%), **2 trades**
- First half (up regime): +$26.56 · Second half (flat/chop): $0.00, 0 trades
- Buy-and-hold on the same window: +$32.17 — this bot keeps 83% of the
  upside with a 1.2% trailing stop as its worst case on the first leg.

## Run

`main.ts` (Node 22, standard library only — the vendored shim in `vendor/`
is a byte-identical copy of the kit's TypeScript SDK) speaks
`agent-fun/bars-replay/v1` over stdin/stdout.

## License

MIT — see [LICENSE](LICENSE).
