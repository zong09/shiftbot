# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
# Install dependencies for both bot and dashboard
npm run install:all

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
[Binance Futures OHLCV]
        ↓  MarketDataService.fetchOHLCV()
[CdcActionZoneService.calculate()]   ← computes EMA12/26, assigns zone 1-8, emits signal
        ↓
[StrategyService] @Cron("0 * * * *") ← runs on every candle close (default 1h)
        ↓ BUY/SELL/HOLD
[TradingService]                     ← openLong / closeLong / checkSLTP
        ↓
[NotificationService]                ← Telegram / LINE Notify
```

### CDC Action Zone V3 — core logic

`src/modules/indicators/cdc-action-zone.service.ts`

Zone is determined by 4 booleans:
- **A** = close > EMA_fast
- **B** = EMA_fast > EMA_slow
- **C** = EMA_fast is rising
- **D** = EMA_slow is rising

Zones 1–4 = bullish, Zones 5–8 = bearish.  
**BUY** when zone transitions bearish→bullish, **SELL** when bullish→bearish.  
`lastZone` is passed from `StrategyService` each cycle to detect zone changes.

### Cron schedule

`StrategyService` uses `@Cron('0 * * * *')` (1h) — if `TIMEFRAME` in `.env` is changed, the decorator must be updated manually:

| Timeframe | Cron            |
|-----------|-----------------|
| 1m        | `* * * * *`     |
| 5m        | `*/5 * * * *`   |
| 15m       | `*/15 * * * *`  |
| 1h        | `0 * * * *`     |
| 4h        | `0 */4 * * *`   |

### State management

`TradingService` stores state in memory (Map + Array) — no database. Trade history and open positions are lost on restart. Add a database layer if persistence is needed.

### Configuration

All values are read from `.env` via `src/config/configuration.ts` and injected with `ConfigService`. There is no validation schema — invalid values fall back to defaults silently.

### Dashboard API endpoints

| Endpoint             | Returns                                   |
|----------------------|-------------------------------------------|
| `GET /api/status`    | CDC zone, open positions, total PnL       |
| `GET /api/trades`    | Full trade history + PnL bar chart data   |
| `GET /api/indicator` | Fresh CDC calculation on-demand           |
| `GET /api/health`    | Uptime check                              |

## Key files

- `src/modules/indicators/cdc-action-zone.service.ts` — indicator core; edit here to adjust zone logic
- `src/modules/strategy/strategy.service.ts` — trading loop entry point + cron
- `src/config/configuration.ts` — .env → typed config object
- `src/common/types/index.ts` — all shared interfaces and enums
- `dashboard/src/components/ZoneBar.jsx` — visual zone indicator in the UI
