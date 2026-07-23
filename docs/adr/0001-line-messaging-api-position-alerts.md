# ADR 0001 — LINE alerts on Live position open/close

Date: 2026-07-23
Status: Accepted

## Context

We want a LINE notification whenever a **Live** position opens or closes.
Grilling the codebase surfaced that the naive framing ("add notification")
was mostly wrong:

1. **Open/close alerts already exist and are already `mode === 'live'`
   gated** in `StrategyService.runForPair()` (`strategy.service.ts:181-248`).
   They call `sendOpenPosition` / `sendClosePosition` for the strategy-signal
   path only.
2. **LINE Notify is dead.** `NotificationService.sendLine()` posts to
   `notify-api.line.me/api/notify`, a service LINE terminated on
   2025-03-31 (token issuance and API access ended 2025-04-01). The path
   cannot deliver.
3. **`NOTIFY_CHANNEL` defaults to `telegram`**, so the LINE branch is never
   even taken today, independent of (2).
4. **Close events other than strategy-signal are silent.** Manual close
   (`closePositionById`, `closeAllPositions`) and on-exchange SL/TP closes
   (detected in `syncPositions`) call `closeLong`/`closeShort` but never
   notify.
5. **Latent PnL bug.** `closeLong`/`closeShort` compute `pnl` as a local and
   write it to the DB, but never set it back on the in-memory `position`
   object. `sendClosePosition` reads `position.closedPnl ?? 0`, so every
   close alert today reports **PnL = +0.00**.

## Decisions

### D1 — Transport: migrate `sendLine` to the LINE Messaging API
LINE Notify is gone; the official replacement is the Messaging API push
endpoint (`https://api.line.me/v2/bot/message/push`), Bearer
channel-access-token auth, JSON body `{ to, messages: [{type:'text', text}] }`.
Push target is a **single userId** (`LINE_TO`). Free-tier push quota applies —
per open/close volume is expected to stay well under it, but this is a known
constraint, not a guarantee.

New env vars (mapping in `configuration.ts`, template in `.env.example`):
- `LINE_CHANNEL_ACCESS_TOKEN` — replaces `LINE_NOTIFY_TOKEN` (removed)
- `LINE_TO` — target userId

### D2 — Notify at the choke point, not the call site
Move `sendClosePosition` **into** `closeLong` / `closeShort` and **remove** the
explicit calls from `StrategyService`. `reason` (`SIGNAL`/`SL`/`TP`/`MANUAL`)
and `mode` already reach these methods. Strategy-signal and manual closes both
funnel through `closeLong`/`closeShort`, so this covers them by construction.
Rejected alternative: adding a notify call at each strategy/manual site
(fragile, easy to miss a future path).

**Exception — SL/TP-hit is not a choke-point path.** Native `STOP_MARKET` /
`TAKE_PROFIT_MARKET` orders fill on Binance directly; the bot never calls
`closeLong`/`closeShort` for them. `syncPositions()` detects the vanished
position and reconciles it **in place** (updates the row, writes a
`SYNC_CLOSE` log). So this path needs **its own** `mode === 'live'` notify
inside `syncPositions`, using a distinct reason `'SYNC'` (label
"ปิดบน Exchange (SL/TP)"). `checkSLTP()` — which *does* route through the
choke point — is legacy and no longer called from the strategy loop, so it is
not the live SL/TP path.

Open alerts stay at the strategy call site: `openLong`/`openShort` have exactly
one caller (strategy), so there is no missing-path gap to close and moving them
would be churn without benefit.

### D3 — Add a `MANUAL` close reason
Manual closes currently pass `reason: 'SIGNAL'`, which would mislabel the
alert as a strategy signal. Add `'MANUAL'` to the `reason` union. It maps to
the existing `else` branch for the trade-log `action` (`CLOSE_LONG`/
`CLOSE_SHORT`), so trade-log behavior is unchanged; only the alert text gains
a "Manual" label.

### D4 — Fix the PnL bug as part of the move (D2)
Set `position.closedPnl = pnl` inside `closeLong`/`closeShort` before
notifying (or pass `pnl` explicitly to `sendClosePosition`). Required for the
choke-point alert to report real PnL.

### D5 — `mode === 'live'` gate stays at every notify call
`syncPositions` runs for **both** modes, so the gate must key off the `mode`
argument at the choke point — otherwise sandbox SL/TP hits would alert.

## Consequences

- `TradingService` gains a dependency on `NotificationService` (inject via
  `TradingModule`). No cycle: `NotificationService` depends only on
  `ConfigService`.
- `sendClosePosition`'s `reason` type widens to include `'MANUAL'`.
- Existing `LINE_NOTIFY_TOKEN` config is removed; anyone on LINE must
  reconfigure with a Messaging API channel + userId.
- `NOTIFY_CHANNEL` must be `line` or `both` for LINE to fire (unchanged
  mechanism; documented so it isn't mistaken for a bug).
- Tests: choke-point notify + live gate + MANUAL reason need coverage in
  `trading.service.spec.ts`; strategy specs that asserted `sendClosePosition`
  calls must move their expectation to the trading layer.

## References
- LINE Notify termination: https://developers.line.biz/en/news/2025/04/01/line-notify/
- Migration guidance: https://developers.line.biz/en/news/2024/10/07/line-notify-will-be-discontinued/
