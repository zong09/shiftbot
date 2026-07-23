# Glossary

Domain terms for ShiftBot. Keep close-event and notification vocabulary
precise — the distinctions below are what the alert design turns on
(see `docs/adr/0001-line-messaging-api-position-alerts.md`).

## Close events

The three distinct ways a position closes. Each is a different trigger, and
until ADR 0001 only the first produced an alert.

- **Strategy-signal close** — the CDC strategy loop
  (`StrategyService.runForPair`) closes a position on a BUY→SELL / SELL→BUY
  zone flip. `reason = 'SIGNAL'`.
- **SL/TP hit (on-exchange)** — a native `STOP_MARKET` / `TAKE_PROFIT_MARKET`
  order fills on Binance while the position is open. The bot does not initiate
  it; `syncPositions()` detects the vanished position after the fact, records a
  `SYNC_CLOSE` trade log, and (Live only) sends a close alert with notify
  reason `'SYNC'`. The legacy `checkSLTP()` path used `reason = 'SL'`/`'TP'`
  but is no longer called.
- **Manual close** — an operator closes via the dashboard
  (`closePositionById`, or `closeAllPositions`). `reason = 'MANUAL'`
  (introduced in ADR 0001; previously mislabeled `'SIGNAL'`).

## Notification terms

- **Choke point** — `closeLong` / `closeShort` in `TradingService`. The
  strategy-signal and manual close paths funnel through these, which is why
  their close alert lives there (ADR 0001, D2) rather than at each caller. The
  **SL/TP-hit** path does *not* pass through the choke point — it is
  reconciled in `syncPositions()` and notified separately (reason `SYNC`).
- **`NOTIFY_CHANNEL`** — env var selecting the transport: `telegram`, `line`,
  or `both`. Defaults to `telegram`. LINE alerts require `line` or `both`.
- **LINE Messaging API push** — the live LINE transport. `POST`
  `https://api.line.me/v2/bot/message/push`, Bearer channel-access-token,
  body `{ to: <userId>, messages: [{ type: 'text', text }] }`. Replaces the
  terminated LINE Notify service (`notify-api.line.me`, dead 2025-03-31).
- **Push target (`LINE_TO`)** — the LINE userId that receives pushes.

## Modes

- **live** — real-money execution on `fapi.binance.com` (`exchangeLive`).
  The only mode that produces notifications.
- **sandbox** — demo execution on `demo-fapi.binance.com` (`exchangeDemo`).
  Runs the full strategy incl. `syncPositions`, but is **never** notified —
  the `mode === 'live'` gate excludes it.
