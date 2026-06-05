# CDC Action Zone V3 Trading Bot

NestJS trading bot for Binance Futures using the **CDC Action Zone V3 2020** indicator.

---

## Project Structure

```
src/
├── config/configuration.ts          ← .env → typed config mapping
├── common/types/index.ts            ← shared interfaces and enums
└── modules/
    ├── market-data/                 ← fetch OHLCV from Binance
    ├── indicators/                  ← CDC Action Zone V3 calculation
    ├── trading/                     ← open/close orders + SL/TP
    ├── notification/                ← Telegram + LINE Notify
    ├── strategy/                    ← main trading loop + cron scheduler
    └── dashboard/                   ← REST API for monitoring
```

---

## Setup

```bash
npm run install:all    # install bot + dashboard dependencies
cp .env.example .env   # fill in API keys
```

## Running

```bash
# Development — bot + dashboard together (hot reload)
npm run dev
# → Bot API:  http://localhost:3000
# → Dashboard: http://localhost:5173

# Bot only
npm run start:dev

# Production
npm run build && npm start
```

---

## CDC Action Zone V3 — 8 Zones

| Zone | Name             | Color      | Condition                                              |
|------|------------------|------------|--------------------------------------------------------|
| 1    | Strong Bull      | Lime       | close > EMA12 > EMA26, both EMAs rising                |
| 2    | Bull             | Green      | close > EMA12 > EMA26, at least one EMA not rising     |
| 3    | Weak Bull        | Olive      | close < EMA12 > EMA26, EMA12 rising                    |
| 4    | Caution Bull     | Dark Green | close < EMA12 > EMA26, EMA12 falling                   |
| 5    | Weak Bear        | Orange     | close > EMA12 < EMA26, EMA12 rising                    |
| 6    | Bear             | Red-Orange | close > EMA12 < EMA26, EMA12 falling                   |
| 7    | Strong Bear (w)  | Red        | close < EMA12 < EMA26, EMA12 rising                    |
| 8    | Strong Bear      | Dark Red   | close < EMA12 < EMA26, both EMAs falling               |

**BUY signal**: zone transitions from 5–8 → 1–4  
**SELL signal**: zone transitions from 1–4 → 5–8

---

## Dashboard API

| Endpoint             | Returns                                  |
|----------------------|------------------------------------------|
| `GET /api/status`    | Bot status, open positions, CDC zone     |
| `GET /api/trades`    | Full trade history + PnL                 |
| `GET /api/indicator` | Latest CDC calculation (on-demand)       |
| `GET /api/health`    | Uptime check                             |

---

## Timeframe Cron Schedule

Update `@Cron(...)` in `strategy.service.ts` to match your `TIMEFRAME` in `.env`:

| Timeframe | Cron Expression |
|-----------|----------------|
| 1m        | `* * * * *`    |
| 5m        | `*/5 * * * *`  |
| 15m       | `*/15 * * * *` |
| 1h        | `0 * * * *`    |
| 4h        | `0 */4 * * *`  |
| 1d        | `0 0 * * *`    |

---

## Risk Warning

⚠️ Always test with **Testnet** (`BINANCE_TESTNET=true`) before trading with real funds.
