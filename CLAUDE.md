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
# → Bot API:  http://localhost:3000
# → Dashboard: http://localhost:5173

# Run bot only
npm run start:dev

# Build for production
npm run build && npm start
```

## Architecture

The project has two parts in the same folder:

**`/src`** — NestJS bot (port 3000)  
**`/dashboard`** — Vite + React UI (port 5173), proxied to bot via `/api → localhost:3000`

### Bot data flow

```
[Binance Futures OHLCV]  ← exchangePublic (no auth — public endpoint)
        ↓  MarketDataService.fetchOHLCVByTimeframe()
        ↓  StrategyService drops the still-forming candle (TIMEFRAME_MS filter)
[CdcActionZoneService.calculate()]   ← EMA periods from DB settings per mode
        ↓
[StrategyService] dynamic cron per mode/symbol ← fires at candle open; see cron table below
        ↓ BUY/SELL/HOLD
[TradingService]                     ← openLong / closeLong / checkSLTP
        ↓                              uses exchangeLive (live) or exchangeDemo (sandbox)
[NotificationService]                ← Telegram / LINE Notify
```

### Exchange instances (MarketDataService)

| Instance | Auth | Endpoint | Purpose |
|---|---|---|---|
| `exchangePublic` | none | `fapi.binance.com` | OHLCV / ticker (public) |
| `exchangeLive` | BINANCE_API_KEY | `fapi.binance.com` | Live order execution |
| `exchangeDemo` | BINANCE_DEMO_API_KEY | `demo-fapi.binance.com` | Demo order execution |

`exchangeDemo` uses ccxt's **`enableDemoTrading(true)`** — swaps every host (fapi/public/sapi) to `demo-fapi.binance.com`. **do NOT use `setSandboxMode(true)`** (points to deprecated testnet) and **do NOT manually string-replace only the fapi host** — leaving public/sapi on mainnet makes Binance reject the key with `-2008 Invalid Api-Key ID`.

### Trading settings (PostgreSQL)

All per-mode trading parameters live in `trading_settings` table (PK = `mode`):

| Field | Default |
|---|---|
| symbol | BTC/USDT:USDT |
| timeframe | 1h |
| leverage | 5 |
| orderSizeUsdt | 100 |
| maxPositions | 1 |
| stopLossPct | 2.0 |
| takeProfitPct | 4.0 |
| emaFast | 12 |
| emaSlow | 26 |

Rows are auto-seeded on first run. Edit via dashboard Settings tab or `PUT /api/settings/:mode`.

### CDC Action Zone V3 — core logic

`src/modules/indicators/cdc-action-zone.service.ts`

Zone is determined by 4 booleans:
- **A** = close > EMA_fast
- **B** = EMA_fast > EMA_slow
- **C** = EMA_fast is rising
- **D** = EMA_slow is rising

Zones 1–4 = bullish, Zones 5–8 = bearish.  
**BUY** when zone transitions bearish→bullish, **SELL** when bullish→bearish.

**Confirm-on-close**: `StrategyService.runForPair()` filters out candles whose close time hasn't passed (`timestamp + TIMEFRAME_MS > now`) before calling `calculate()` — signals are evaluated on closed candles only. The chart (`calculateHistory`) still receives the live candle.

**SL/TP = native exchange orders**: on entry, `TradingService` places reduceOnly `STOP_MARKET` + `TAKE_PROFIT_MARKET` orders on Binance (ids stored as `slOrderId`/`tpOrderId` on the position) so protection triggers even while the bot is down. Every close path (signal, manual, sync) cancels the sibling orders first. `checkSLTP()` is legacy — no longer called from the strategy loop. When a position closes on-exchange, `syncPositions` records realized PnL from the Binance income endpoint (mark-price fallback, never hard-coded 0).

**Required env**: boot fails without `JWT_SECRET` (min 32 chars — `openssl rand -hex 32`); first-run admin seeding fails when `ADMIN_PASSWORD` is unset/default `admin1234`. Optional: `DASHBOARD_ORIGIN` (comma-separated CORS allowlist), `DB_SSL_REJECT_UNAUTHORIZED=false` (self-signed DB certs). TypeORM `synchronize` is auto-disabled when `NODE_ENV=production`.

Methods accept optional `emaFastOverride` / `emaSlowOverride` — StrategyService passes per-mode values from DB.

### Cron schedule

`StrategyService` creates **one dynamic cron job per mode/symbol pair** at startup using `SchedulerRegistry`. Changing `timeframe` via `PUT /api/settings/:mode` automatically reschedules that pair's job — no restart required. Jobs fire at candle open and evaluate the last **closed** candle (see Confirm-on-close above).

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

`synchronize: true` in `AppModule` — safe for dev, **disable before production**.

### Dashboard API endpoints

> [!IMPORTANT]
> All `/api/*` endpoints except `/api/auth/login` require authentication. Set `Authorization: Bearer <JWT_TOKEN>` in request headers.

| Endpoint | Returns / Purpose |
|---|---|
| `POST /api/auth/login` | Login with username and password, returns JWT token |
| `GET /api/status` | CDC zone, open positions, total PnL (auth required) |
| `GET /api/trades` | Full trade history (auth required) |
| `GET /api/candles?timeframe=` | OHLCV + CDC indicator overlay (emaFast, emaSlow, zone, signal) (auth required) |
| `GET /api/indicator` | Latest CDC calculation on-demand (auth required) |
| `GET /api/settings` | Trading settings for both modes (auth required) |
| `GET /api/settings/:mode` | Settings for one mode (auth required) |
| `PUT /api/settings/:mode` | Update settings for one mode (auth required) |
| `POST /api/positions/:id/close` | Manually close a single position by id (market close via `TradingService.closePositionById`) |
| `GET /api/health` | Uptime check (auth required) |

## Key files

- `src/modules/indicators/cdc-action-zone.service.ts` — indicator core
- `src/modules/strategy/strategy.service.ts` — trading loop + cron
- `src/modules/trading/trading.service.ts` — order execution (reads settings from DB)
- `src/modules/trading-settings/trading-settings.service.ts` — settings CRUD
- `src/modules/market-data/market-data.service.ts` — 3 exchange instances
- `src/modules/auth/` — JWT authentication module, services, controller, guard [NEW]
- `src/database/entities/` — TypeORM entities (including UserEntity [NEW])
- `src/config/configuration.ts` — .env mapping (Binance keys, DB, notifications, admin/jwt credentials)
- `dashboard/src/App.jsx` — main React app, authentication state, data fetching [MODIFY]
- `dashboard/src/components/Login.jsx` — login form with glassmorphism styling [NEW]
- `dashboard/src/components/PriceChart.jsx` — chart with CDC overlay + interval selector
- `dashboard/src/components/Settings.jsx` — per-mode settings form
