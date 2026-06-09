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
[CdcActionZoneService.calculate()]   ← EMA periods from DB settings per mode
        ↓
[StrategyService] dynamic cron per (mode, symbol) pair
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

`exchangeDemo` URL is manually patched — **do NOT use `setSandboxMode(true)`** (points to wrong testnet endpoint).  
`BINANCE_DEMO_API_KEY` must use the same keys as the live account (not keys from demo.binance.com).

### Trading settings (PostgreSQL)

All per-mode trading parameters live in `trading_settings` table (composite PK = `mode` + `symbol`).  
Multiple pairs per mode are supported. Rows are auto-seeded on first run.

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

Methods accept optional `emaFastOverride` / `emaSlowOverride` — StrategyService passes per-mode values from DB.

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

`synchronize: true` in `AppModule` — safe for dev, **disable before production**.

### Dashboard API endpoints

| Endpoint | Returns |
|---|---|
| `GET /api/status?mode=live` | CDC zone, open positions, total PnL, account balance |
| `GET /api/trades?mode=live` | Full trade history |
| `GET /api/candles?timeframe=&symbol=` | OHLCV + CDC indicator overlay (emaFast, emaSlow, zone, signal) |
| `GET /api/indicator?symbol=` | Latest CDC calculation on-demand |
| `GET /api/settings` | Trading settings for both modes (grouped) |
| `GET /api/settings/:mode` | All pairs for one mode |
| `POST /api/settings/:mode/pairs` | Add a new trading pair `{ symbol }` |
| `DELETE /api/settings/:mode/pairs?symbol=` | Remove a pair (closes open positions first) |
| `PUT /api/settings/:mode` | Update settings for one pair `{ symbol, ...fields }` |
| `GET /api/health` | Uptime check |

## Key files

- `src/modules/indicators/cdc-action-zone.service.ts` — indicator core
- `src/modules/strategy/strategy.service.ts` — trading loop + dynamic cron per pair
- `src/modules/trading/trading.service.ts` — order execution (reads settings from DB)
- `src/modules/trading-settings/trading-settings.service.ts` — settings CRUD (composite PK mode+symbol)
- `src/modules/market-data/market-data.service.ts` — 3 exchange instances + fetchBalance()
- `src/modules/dashboard/dashboard.controller.ts` — all API endpoints
- `src/database/entities/` — TypeORM entities
- `src/config/configuration.ts` — minimal .env mapping (Binance keys, DB, notifications)
- `dashboard/src/App.jsx` — main React app, mode/pair state, data fetching
- `dashboard/src/components/PriceChart.jsx` — chart with CDC overlay + interval selector
- `dashboard/src/components/StatusCard.jsx` — bot status, CDC zone, account balance
- `dashboard/src/components/Settings.jsx` — per-mode/per-pair settings form

## Notes for AI assistants

- Symbol format in DB and API: `BTC/USDT:USDT` (ccxt USDM futures format) — UI displays as `BTC/USDT`
- NestJS version is **v10** — pin all `@nestjs/*` devDeps to `@10`, use `--legacy-peer-deps`
- TypeScript tests use Jest — needs `@types/jest` and `"types": ["jest", "node"]` in tsconfig
- `fetchBalance()` uses raw `fapiPrivateV3GetBalance({})` not ccxt's `fetchBalance()` abstraction (field mapping is wrong for USDM futures)
