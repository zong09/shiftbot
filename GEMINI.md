# GEMINI.md

This file provides guidance to Gemini CLI when working with code in this repository.

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

# Build for production (the bot serves the built dashboard — one deployable)
npm run build && npm start

# Tests
npm test
```

## Architecture

The project has two parts in the same folder:

**`/src`** — NestJS bot (port 3001, override with `PORT`)  
**`/dashboard`** — Vite + React UI (port 5173), proxied to bot via `/api → localhost:3001`; served statically by the bot in production

### Bot data flow

```
[Binance Futures kline WebSocket] ← MarketDataService.subscribeToKlineStream() (REST backfill + live WS)
        ↓  StrategyService drops the still-forming candle (signals on closed candles only)
[CdcActionZoneService.calculate()]   ← EMA periods from DB settings per (mode, symbol)
        ↓
[StrategyService] dynamic cron per (mode, symbol) pair, fires at candle open
        ↓ BUY/SELL/HOLD
[TradingService]                     ← openLong/closeLong, openShort/closeShort (both directions)
        ↓                              uses exchangeLive (live) or exchangeDemo (sandbox)
[NotificationService]                ← LINE + Telegram, both configured per mode in the DB
```

SL/TP are **native reduceOnly orders on Binance** (`STOP_MARKET` + `TAKE_PROFIT_MARKET`) placed on entry, so they trigger even while the bot is down. `TradingService.checkSLTP()` still exists but its call site in `StrategyService.runForPair()` is commented out (`strategy.service.ts:180`, locked down by a spec) — the CDC signal is the only exit path; do not assume it runs.

### Exchange instances (MarketDataService)

| Instance | Auth | Endpoint | Purpose |
|---|---|---|---|
| `exchangePublic` | none | `fapi.binance.com` | REST OHLCV backfill / ticker when live is disabled |
| `exchangeLive` | BINANCE_API_KEY | `fapi.binance.com` | Live order execution (REST backfill too when configured) |
| `exchangeDemo` | BINANCE_DEMO_API_KEY | `demo-fapi.binance.com` | Demo order execution |

`exchangeDemo` uses ccxt's **`enableDemoTrading(true)`** — it swaps *every* host (fapi/public/sapi) to `demo-fapi.binance.com`. **Do NOT use `setSandboxMode(true)`** (deprecated testnet) and **do NOT manually string-replace only the fapi host** — leaving public/sapi on mainnet makes Binance reject the key with `-2008 Invalid Api-Key ID` (see `market-data.service.ts:51-56`).  
`BINANCE_DEMO_API_KEY` must use the same keys as the live account (not keys from demo.binance.com).

If `BINANCE_API_KEY` is absent or a placeholder, live mode is disabled entirely (`isLiveEnabled()` false) and `StrategyService` only schedules `sandbox` jobs.

### Trading settings (PostgreSQL)

All per-mode trading parameters live in `trading_settings` table (composite PK = `mode` + `symbol`).  
Multiple pairs per mode are supported. Rows are auto-seeded on first run.

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
| status | on |

Edit via dashboard Settings tab or `PUT /api/settings/:mode`.

### CDC Action Zone V3 — core logic

`src/modules/indicators/cdc-action-zone.service.ts`

Zone is determined by 4 booleans:
- **A** = close > EMA_fast
- **B** = EMA_fast > EMA_slow
- **C** = EMA_fast is rising
- **D** = EMA_slow is rising

Zones 1–4 = bullish, Zones 5–8 = bearish.  
**BUY** when zone transitions bearish→bullish, **SELL** when bullish→bearish.

Methods accept optional `emaFastOverride` / `emaSlowOverride` — StrategyService passes per-(mode, symbol) values from DB.

**Confirm-on-close**: `runForPair()` filters out candles whose close time has not passed before calling `calculate()`. The chart (`calculateHistory`) still receives the live candle.

### Cron schedule

`StrategyService` creates dynamic cron jobs at startup — one per `(mode, symbol)` pair — using `SchedulerRegistry`.  
Changing `timeframe` via `PUT /api/settings/:mode` automatically reschedules that pair's job, no restart required.

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

TypeORM `synchronize` auto-disables when `NODE_ENV=production` (dev only — never rely on it against a real DB). `migrationsRun: true`, so migrations execute on every boot; migration classes are listed **explicitly** in `src/app.module.ts` (not by glob), and a new class that is not added to that array never runs.

### Required env / boot-time validation

- `JWT_SECRET` — boot throws if unset or under 32 chars.
- `TOKEN_ENCRYPTION_KEY` — boot throws unless exactly 64 hex chars. AES-256-GCM key for every secret in `notification_settings`; never reuse `JWT_SECRET`.
- `ADMIN_PASSWORD` — first-run admin seeding throws if unset, still `admin1234`, or under 8 chars.
- `DATABASE_URL` (optional) takes priority over `DB_*`. `DASHBOARD_ORIGIN` (optional) is the CORS allowlist and **fails closed** in production.
- **No notification env vars exist.** LINE and Telegram credentials live per mode in `notification_settings`, encrypted at rest, edited in the dashboard. Do not reintroduce `LINE_CHANNEL_ACCESS_TOKEN`, `LINE_TO`, `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID` or `NOTIFY_CHANNEL`.

### Dashboard API endpoints

> [!IMPORTANT]
> All `/api/*` endpoints require `Authorization: Bearer <JWT_TOKEN>`, except `/api/auth/login` and `/api/line/webhook/:mode` — the latter is authenticated by LINE's `x-line-signature` HMAC instead.

| Endpoint | Returns / Purpose |
|---|---|
| `POST /api/auth/login` | Login with username and password, returns JWT token (rate-limited: 5/min) |
| `GET /api/status?mode=live` | CDC zone, open positions, total PnL, account balance |
| `GET /api/trades?mode=live` | Full trade history |
| `GET /api/candles?timeframe=&symbol=` | OHLCV + CDC indicator overlay (emaFast, emaSlow, zone, signal) |
| `GET /api/indicator?symbol=` | Latest CDC calculation on-demand |
| `GET /api/settings` | Trading settings for both modes (grouped) |
| `GET /api/settings/:mode` | All pairs for one mode |
| `POST /api/settings/:mode/pairs` | Add a new trading pair `{ symbol }` |
| `DELETE /api/settings/:mode/pairs?symbol=` | Remove a pair (closes open positions first) |
| `PUT /api/settings/:mode` | Update settings for one pair `{ symbol, ...fields }` — 404s if the pair does not exist |
| `POST /api/positions/:id/close` | Manually market-close a single position by id |
| `GET /api/settings/notifications/:mode` | Per-mode LINE + Telegram config, every secret masked |
| `PUT /api/settings/notifications/:mode` | Update notification config; an omitted secret leaves the stored one alone |
| `POST /api/settings/notifications/:mode/test?channel=line\|telegram` | Send a real test push on one channel |
| `POST /api/line/webhook/:mode` | Inbound LINE webhook — **public**, verified by HMAC signature |
| `GET /api/health` | Uptime check |

## Key files

- `src/modules/indicators/cdc-action-zone.service.ts` — indicator core
- `src/modules/strategy/strategy.service.ts` — trading loop + dynamic cron per pair
- `src/modules/trading/trading.service.ts` — order execution (reads settings from DB)
- `src/modules/trading-settings/trading-settings.service.ts` — settings CRUD (composite PK mode+symbol)
- `src/modules/notification-settings/notification-settings.service.ts` — per-mode LINE + Telegram config, secret encrypt/decrypt/mask
- `src/modules/notification/line-webhook.controller.ts` — inbound LINE webhook (HMAC over the raw body; hence `rawBody: true` in `main.ts`)
- `src/common/crypto.util.ts` — AES-256-GCM encrypt/decrypt for secrets at rest
- `src/database/migrations/` — TypeORM migrations, run at boot
- `src/modules/market-data/market-data.service.ts` — 3 exchange instances + kline WebSocket streaming + fetchBalance()
- `src/modules/auth/` — JWT authentication module, services, controller, guard [NEW]
- `src/modules/dashboard/dashboard.controller.ts` — all API endpoints (protected by JwtAuthGuard)
- `src/database/entities/` — TypeORM entities (including UserEntity [NEW])
- `src/config/configuration.ts` — .env mapping (Binance keys, DB, admin/jwt/token-encryption credentials — **no notification vars**)
- `dashboard/src/App.jsx` — main React app, authentication state, mode/pair state, data fetching
- `dashboard/src/components/Login.jsx` — login form with glassmorphism styling [NEW]
- `dashboard/src/components/PriceChart.jsx` — chart with CDC overlay + interval selector
- `dashboard/src/components/StatusCard.jsx` — bot status, CDC zone, account balance
- `dashboard/src/components/Settings.jsx` — per-mode/per-pair settings form

## Notes for AI assistants

- Symbol format in DB and API: `BTC/USDT:USDT` (ccxt USDM futures format) — UI displays as `BTC/USDT`
- NestJS version is **v10** — pin all `@nestjs/*` devDeps to `@10`, use `--legacy-peer-deps`
- TypeScript tests use Jest — needs `@types/jest` and `"types": ["jest", "node"]` in tsconfig
- `fetchBalance()` uses raw `fapiPrivateV3GetBalance({})` not ccxt's `fetchBalance()` abstraction (field mapping is wrong for USDM futures)
