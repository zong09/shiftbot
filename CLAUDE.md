# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
# Install dependencies for both bot and dashboard
npm run install:all

# Start PostgreSQL (required before running bot)
docker compose up -d

# Run bot + dashboard together (dev mode)
npm run dev
# → Bot API:  http://localhost:3001
# → Dashboard: http://localhost:5173

# Run bot only
npm run start:dev

# Build for production (compiles NestJS + builds & bundles the dashboard into dashboard/dist)
npm run build && npm start

# Tests (Jest, ts-jest — *.spec.ts colocated with source under src/)
npm test
npm run test:watch
npm run test:cov
npx jest src/modules/trading/trading.service.spec.ts   # single file
npx jest -t "closeLong"                                 # by test name
```

There is no lint script/config in either `package.json` — don't invent one.

In production, `AppModule`'s `ServeStaticModule` serves `dashboard/dist` directly from the bot process (excluding `/api/*`), so `npm run build && npm start` is a single deployable — no separate dashboard host needed.

## Architecture

The project has two parts in the same folder:

**`/src`** — NestJS bot (port 3001, override with `PORT`)
**`/dashboard`** — Vite + React UI (dev server port 5173), proxied to bot via `/api → localhost:3001` (see `dashboard/vite.config.mjs`); served statically by the bot in production.

### Bot data flow

```
[Binance Futures kline WebSocket]  ← MarketDataService.subscribeToKlineStream() (REST backfill + live WS updates)
        ↓
        ↓  StrategyService drops the still-forming candle (TIMEFRAME_MS filter)
[CdcActionZoneService.calculate()]   ← EMA periods from DB settings per (mode, symbol)
        ↓
[StrategyService] dynamic cron per (mode, symbol) pair ← fires at candle open; see cron table below
        ↓ BUY/SELL/HOLD
[TradingService]                     ← openLong/closeLong, openShort/closeShort (both directions traded)
        ↓                              uses exchangeLive (live) or exchangeDemo (sandbox)
[NotificationService]                ← LINE + Telegram, both per-mode DB config (see notification-settings)
```

The strategy is long **and** short: a BUY signal closes open shorts then opens long; a SELL signal closes open longs then opens short.

### Exchange instances (MarketDataService)

| Instance | Auth | Endpoint | Purpose |
|---|---|---|---|
| `exchangePublic` | none | `fapi.binance.com` | REST OHLCV backfill / ticker when live is disabled |
| `exchangeLive` | BINANCE_API_KEY | `fapi.binance.com` | Live order execution (used for REST backfill too when configured) |
| `exchangeDemo` | BINANCE_DEMO_API_KEY | `demo-fapi.binance.com` | Demo order execution |

`exchangeDemo` uses ccxt's **`enableDemoTrading(true)`** — swaps every host (fapi/public/sapi) to `demo-fapi.binance.com`. **do NOT use `setSandboxMode(true)`** (points to deprecated testnet) and **do NOT manually string-replace only the fapi host** — leaving public/sapi on mainnet makes Binance reject the key with `-2008 Invalid Api-Key ID`.

If `BINANCE_API_KEY` is absent/placeholder, live mode is disabled entirely (`isLiveEnabled()` false) and `StrategyService` only schedules jobs for `sandbox`.

### Live candle data: WebSocket-first, REST fallback

`MarketDataService.subscribeToKlineStream()` is the only path `fetchOHLCVByTimeframe`/`fetchOHLCV` use. Per `symbol:timeframe` cache key:

- First call REST-backfills 200 candles, then opens a Binance kline WebSocket (`wss://fstream.binance.com/market/ws/<symbol>@kline_<tf>`) to keep the cache updated in real time.
- The cache is only trusted when fresh (newest candle ≤ 2 timeframes old) **and** contiguous over the last 30 candles — a WS gap forces a REST refetch rather than feeding a gapped series into the EMA.
- A watchdog reconnects the socket if idle > 60s; on reconnect it REST-backfills first, then resubscribes.
- `closeStreamsForSymbol()` tears down every timeframe stream for a symbol once no mode trades it anymore (called from the remove-pair endpoint).
- Note the dated comment in the code: Binance moved kline streams under `/market` (2026-04-23) — the legacy `/ws` path still accepts connections but never pushes data, so don't "simplify" the URL back to it.

### Trading settings (PostgreSQL) — multi-pair per mode

`trading_settings` table has a **composite PK `(mode, symbol)`** — each mode (`live`/`sandbox`) can run multiple symbols concurrently, each with its own settings row and cron job.

| Field | Default |
|---|---|
| symbol | BTC/USDT:USDT |
| timeframe | 1h |
| leverage | 5 |
| orderSizeUsdt | 100 |
| maxPositions | 1 (per side — long and short each get their own count) |
| stopLossPct | 2.0 |
| takeProfitPct | 4.0 |
| emaFast | 12 |
| emaSlow | 26 |
| status | `on` (`on` \| `pause` \| `off`) |

- A mode is seeded with one pair (`BTC/USDT:USDT`) on first boot if empty (`seedIfEmpty`).
- New pairs are created only via `addPair` (`POST /api/settings/:mode/pairs`), which also schedules its cron job — `PUT /api/settings/:mode` updates an existing pair's fields but 404s if the pair doesn't exist yet (prevents phantom rows with no job).
- `status: 'off'` auto-closes all open positions for that pair before disabling it; `pause` keeps `syncPositions` running (so exchange-side SL/TP fills still reconcile) but skips evaluating new signals.
- Removing a pair (`DELETE /api/settings/:mode/pairs`) refuses while positions are still open, then deletes the cron job, the settings row, and (if no other mode still trades that symbol) the WS streams.

### CDC Action Zone V3 — core logic

`src/modules/indicators/cdc-action-zone.service.ts`

Zone is determined by 4 booleans:
- **A** = close > EMA_fast
- **B** = EMA_fast > EMA_slow
- **C** = EMA_fast is rising
- **D** = EMA_slow is rising

Zones 1–4 = bullish, Zones 5–8 = bearish.
**BUY** when zone transitions bearish→bullish, **SELL** when bullish→bearish.

**Confirm-on-close**: `StrategyService.runForPair()` filters out candles whose close time hasn't passed (`timestamp + TIMEFRAME_MS > now`) before calling `calculate()` — signals are evaluated on closed candles only. The chart (`calculateHistory`) still receives the live candle. After a restart, `lastZone` is unknown; it's reconstructed from the second-to-last candle so a zone transition spanning the restart still fires instead of being swallowed as the first HOLD.

**SL/TP = native exchange orders only**: on entry, `TradingService` places reduceOnly `STOP_MARKET` + `TAKE_PROFIT_MARKET` orders on Binance (ids stored as `slOrderId`/`tpOrderId` on the position) so protection triggers even while the bot is down. Every close path (signal, manual, sync) cancels the sibling orders first, and a stale-order sweep runs before every new entry (a failed cancel from an earlier close can otherwise leave a stray reduceOnly order that later market-closes the *next* position). `checkSLTP()` still exists on `TradingService` but its call site in `StrategyService.runForPair()` is commented out — the CDC signal is the only exit path now; don't assume it runs. When a position closes on-exchange, `syncPositions` records realized PnL from the Binance income endpoint (mark-price fallback, never hard-coded 0).

Methods accept optional `emaFastOverride` / `emaSlowOverride` — StrategyService passes per-(mode, symbol) values from DB.

### Position lifecycle & concurrency safety

Positions move `open → closing → closed`. The `closing` state is a single-flight claim (an atomic `UPDATE ... WHERE status = 'open'`) so a cron-triggered close and a concurrent manual/API close, or two overlapping `syncPositions` polls, can't both submit exchange orders or double-write a trade log/PnL. A `closing` row that never resolves (process died mid-close) is reverted to `open` at boot (`TradingService.onApplicationBootstrap`) and reconciled by the next `syncPositions`.

A failed order-close (exchange error) does **not** advance `StrategyService`'s `lastZone` and does not open the opposite side — the signal is left live so the next candle retries the flip instead of the bot silently drifting out of sync with the intended position.

### Required env / boot-time validation

- `JWT_SECRET` — boot throws if unset or < 32 chars (`openssl rand -hex 32`).
- `TOKEN_ENCRYPTION_KEY` — boot throws if unset or not exactly 64 hex chars (`openssl rand -hex 32`). AES-256-GCM key encrypting every secret stored per-mode in `notification_settings` — LINE channel access token, LINE channel secret, Telegram bot token (`src/common/crypto.util.ts`) — never reused for `JWT_SECRET`.
- `ADMIN_PASSWORD` — first-run admin seeding throws if unset, still `admin1234`, or < 8 chars.
- `DATABASE_URL` (optional) — if set, takes priority over `DB_HOST`/`DB_USER`/etc.; SSL auto-enables in production or when the URL host looks like Railway/Supabase/Neon.
- `DASHBOARD_ORIGIN` (optional, comma-separated) — CORS allowlist. In production an unset allowlist **fails closed** (no cross-origin requests) since the dashboard is served same-origin; in dev CORS is permissive by default.
- `DB_SSL_REJECT_UNAUTHORIZED=false` — for self-signed DB certs.
- TypeORM `synchronize` auto-disables when `NODE_ENV=production` (dev only — never rely on it against a real DB).
- Login is rate-limited: `ThrottlerModule` caps `/api/auth/login` at 5 requests/60s.

### Migrations

`migrationsRun: true` — migrations execute on every boot, in dev and production alike. Migration classes are listed **explicitly** in `src/app.module.ts` (not by glob) so they resolve identically under `nest start` and the compiled `dist` build; add each new class to that array or it will never run.

Registered so far: `CreateNotificationSettings1785024000000`, `AddLineChannelSecret1785110400000` (adds `lineChannelSecretEnc` for webhook signature verification), `AddTelegramNotificationSettings1785196800000` (splits `enabled` into `lineEnabled`/`telegramEnabled` and adds the Telegram columns).

Because the schema was originally created by `synchronize`, existing production tables may predate their migration. Write DDL idempotently (`CREATE TABLE IF NOT EXISTS`, `ADD COLUMN IF NOT EXISTS`) and reuse TypeORM's own generated constraint names, so a migration-created table is byte-identical to a synchronize-created one and later `synchronize` runs see no drift. Only `notification_settings` has a migration so far — the other tables remain synchronize-created and have no baseline migration yet.

**A migration that renames or drops a column can't rely on reading the old one in dev.** TypeORM runs `synchronize` *before* `migrationsRun`, so with synchronize on (`NODE_ENV !== 'production'`) the column is already gone by the time the migration's `UPDATE` executes. `AddTelegramNotificationSettings` copies `enabled` → `lineEnabled` behind an `information_schema` guard for exactly this reason; the copy only actually lands where synchronize is off.

### Cron schedule

`StrategyService` creates **one dynamic cron job per (mode, symbol) pair** at startup using `SchedulerRegistry`, plus a fire-and-forget warm-up run of every pair immediately on boot (so `/api/status` has data before the first cron fire). Changing `timeframe` via `PUT /api/settings/:mode` automatically reschedules that pair's job — no restart required. Jobs fire at candle open and evaluate the last **closed** candle (see Confirm-on-close above).

| Timeframe | Cron            |
|-----------|-----------------|
| 1m        | `* * * * *`     |
| 5m        | `*/5 * * * *`   |
| 15m       | `*/15 * * * *`  |
| 1h        | `0 * * * *`     |
| 4h        | `0 */4 * * *`   |
| 1d        | `0 0 * * *`     |

### State management

All state persists in PostgreSQL. Positions and trade history survive bot restarts.

### Dashboard API endpoints

> [!IMPORTANT]
> All `/api/*` endpoints except `/api/auth/login` and `/api/line/webhook/:mode` require authentication. Set `Authorization: Bearer <JWT_TOKEN>` in request headers.

| Endpoint | Purpose |
|---|---|
| `POST /api/auth/login` | Login with username and password, returns JWT token (rate-limited: 5/min) |
| `GET /api/status?mode=` | Per-pair status (zone, positions, PnL) plus backward-compat aggregate fields; also triggers `syncPositions` |
| `GET /api/trades?mode=&symbol=` | Trade history, optionally filtered by symbol |
| `GET /api/candles?timeframe=&symbol=` | OHLCV + CDC indicator overlay for the chart |
| `GET /api/indicator?symbol=` | Latest CDC calculation on-demand |
| `GET /api/settings` | Settings for both modes, grouped |
| `GET /api/settings/:mode` | All pairs' settings for one mode |
| `PUT /api/settings/:mode` | Update an existing pair's settings (body includes `symbol`); validates `emaFast < emaSlow` and min notional before saving |
| `POST /api/settings/:mode/pairs` | Add a new symbol to a mode (creates settings row + cron job) |
| `DELETE /api/settings/:mode/pairs?symbol=` | Remove a pair — refuses if positions are still open |
| `POST /api/positions/:id/close` | Manually market-close a single position by id |
| `GET /api/health` | Uptime check |
| `GET /api/settings/notifications/:mode` | Per-mode LINE **and** Telegram notification settings — every secret returned masked (e.g. `8Ff2•••wQ8f`) |
| `PUT /api/settings/notifications/:mode` | Update per-mode notification settings (both channels in one payload); a provided secret is encrypted before storage, an omitted one leaves the stored value untouched |
| `POST /api/settings/notifications/:mode/test?channel=line\|telegram` | Send a real test push on one channel; 400s (and does **not** stamp last-sent) when that channel has no usable config |
| `POST /api/line/webhook/:mode` | Inbound LINE webhook — **public**, authenticated by `x-line-signature` HMAC instead of JWT |

### LINE webhook (finding the group id)

The LINE push target (`notification_settings.lineGroupId`) can only be learned from an inbound webhook event. `LineWebhookController` (`src/modules/notification/line-webhook.controller.ts`) verifies the signature, logs `source` for every event, and on `join` (bot invited to a group) replies with the id so it can be pasted into Settings → GROUP ID. It never writes the id itself — an auto-write would silently clobber a configured target.

- **`:mode` is not vestigial** — it picks the `notification_settings` row whose channel secret verifies the signature and whose access token sends the reply. A webhook URL ending in `/live` while only the sandbox row has a secret 401s everything, including the console's Verify button.
- The channel secret lives in `lineChannelSecretEnc`, encrypted with `TOKEN_ENCRYPTION_KEY` exactly like the access token. `getDecryptedChannelSecret()` deliberately returns `null` rather than throwing on an unreadable secret (unlike `getDecryptedToken()`), so the webhook answers 401 instead of 500 — a 500 only makes LINE retry a doomed request.
- Signature = HMAC-SHA256 over the **raw** request bytes → base64. Hence `rawBody: true` in `main.ts`; never HMAC `JSON.stringify(body)`, whitespace/unicode differences break it.
- The handler takes `@Body() body: any` on purpose — the global `ValidationPipe({ forbidNonWhitelisted: true })` would 400 LINE's payload if a DTO class were used. `line-webhook.rawbody.spec.ts` boots a real server to lock both of these down, since either failing is silent.
- Returns 200 for `events: []` (the console's Verify button) and for a failed reply; 401 for a bad/missing signature or an unset secret.
- The dashboard's WEBHOOK URL field is **read-only** — `NotificationSettings.jsx` computes `${window.location.origin}/api/line/webhook/${mode}` and offers a copy button, so the value pasted into the LINE Developers Console can't drift from the route the bot actually serves. Correct because the bot serves the dashboard same-origin in production; from a Vite dev server it shows `localhost:5173`, which LINE can't verify.
- `notification_settings.lineWebhookUrl` (column + DTO field) still exists but is now written by nobody and read by nobody — dead, but left in place; no migration drops it.
- **No notification env vars exist any more.** `LINE_CHANNEL_ACCESS_TOKEN`, `LINE_TO`, `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID` and `NOTIFY_CHANNEL` were all removed from `configuration.ts` and `.env.example`; don't reintroduce them. Every credential and switch lives in `notification_settings` per mode.

### Notification channels (LINE + Telegram, both per-mode DB config)

`notification_settings` holds a **complete, independent config per channel per mode**: `lineEnabled` / `telegramEnabled`, the credentials, and a full set of five event flags each — LINE's are unprefixed (`notifyOpen`…), Telegram's are prefixed (`telegramNotifyOpen`…). The unprefixed names were kept so existing rows needed no data migration; the asymmetry with `lineEnabled` is deliberate, not an oversight.

- `NotificationService.send()` fetches the row **once** and calls both channel senders, each inside its own `try/catch`. A channel that is off, unconfigured, or failing never suppresses the other — that was the old `NOTIFY_CHANNEL` bug (an empty env var defaulted to `'telegram'` and silently made `sendLine` unreachable, so *no* notification fired at all).
- The internal `eventFlag` is a **logical key** (`'open' | 'close' | 'tpsl' | 'error' | null`) resolved per channel through the `EVENT_COLUMN` map — never a column name, since the two channels use different columns for the same event.
- `telegramBotTokenEnc` is encrypted with `TOKEN_ENCRYPTION_KEY` exactly like the LINE token, and `getDecryptedTelegramToken()` mirrors `getDecryptedToken()` (throws on an unreadable value; the caller's `try/catch` degrades it to a logged error).
- `sendTest(mode, channel)` **returns a boolean** and deliberately ignores the channel's enable flag — the dashboard panel stays editable while a channel is off, so the button must work there. The controller only calls `markSent` when it returned `true`, otherwise the "last sent" line would claim a send that never happened. `false` means *unconfigured*; a provider **rejection** is different — it throws `BadGatewayException(providerDetail(err))` so the dashboard shows the real reason instead of a 500 whose only detail is a stack trace. The `return await` in its `try` is load-bearing: an un-awaited return settles outside the `try` and the `catch` never fires.
- `providerDetail()` appends axios's `response.data` to `err.message` at every catch site. Without it LINE/Telegram failures log as a bare `Request failed with status code 401` and never say *which* credential is wrong — that cost a four-round debug session once.
- `updateSettings()` runs the whole DTO through `trimStrings()` right after the row-exists check, before any value is read. Credentials and ids are pasted from provider consoles and a clipboard copy routinely drags a trailing newline in; it is invisible in the form, reaches the `Authorization` header, and comes back as an unexplained 401. Side effect worth knowing: a whitespace-only secret trims to `''` (falsy) and therefore **keeps** the stored value rather than clobbering it.
- `telegramMessageThreadId` is optional and only added to the payload when set (Telegram rejects a null `message_thread_id`). It targets a topic inside a forum-style group.
- `notifyDailySummary` / `telegramNotifyDailySummary` are stored and shown in the UI but **have no sender** — there is no daily-summary cron. The checkbox descriptions say so.

## Key files

- `src/modules/indicators/cdc-action-zone.service.ts` — indicator core
- `src/modules/strategy/strategy.service.ts` — trading loop, cron scheduling, per-pair signal state
- `src/modules/trading/trading.service.ts` — order execution, protective orders, position sync (long + short)
- `src/modules/trading-settings/trading-settings.service.ts` — per-(mode, symbol) settings CRUD
- `src/modules/notification-settings/notification-settings.service.ts` — per-mode LINE + Telegram settings CRUD, secret encrypt/decrypt/mask
- `src/common/crypto.util.ts` — AES-256-GCM encrypt/decrypt for the LINE access token at rest
- `src/modules/market-data/market-data.service.ts` — exchange instances + WebSocket kline streaming
- `src/modules/auth/` — JWT authentication (login, guard, admin-user seeding)
- `src/database/entities/` — TypeORM entities (`position`, `trade-log`, `trading-settings`, `notification-settings`, `user`)
- `src/database/migrations/` — TypeORM migrations, run at boot (see Migrations above)
- `src/config/configuration.ts` — .env mapping (Binance keys, DB, notifications, admin/jwt/token-encryption credentials)
- `src/app.module.ts` — TypeORM/DATABASE_URL wiring, static dashboard serving, throttler
- `dashboard/src/App.jsx` — main React app, auth state, data fetching
- `dashboard/src/components/PriceChart.jsx` — chart with CDC overlay + interval selector
- `dashboard/src/components/Settings.jsx` — per-pair settings form
- `dashboard/src/components/NotificationSettings.jsx` — per-mode notification form; a `CHANNELS` table drives the channel cards, fields and event rows, so adding a third provider means adding one entry there plus the DB columns
