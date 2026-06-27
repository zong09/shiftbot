# CDC Action Zone V3 Trading Bot

NestJS trading bot for Binance Futures using the **CDC Action Zone V3 2020** indicator.

---

## Project Structure

```
src/
├── config/configuration.ts          ← .env → typed config (Binance keys, DB, notifications, JWT)
├── common/types/index.ts            ← shared interfaces and enums
└── modules/
    ├── market-data/                 ← fetch OHLCV from Binance (3 exchange instances)
    ├── indicators/                  ← CDC Action Zone V3 calculation
    ├── trading/                     ← open/close orders + SL/TP
    ├── trading-settings/            ← per-mode settings CRUD (PostgreSQL)
    ├── notification/                ← Telegram + LINE Notify
    ├── strategy/                    ← main trading loop + cron scheduler
    ├── auth/                        ← JWT authentication (login & api guard)
    └── dashboard/                   ← REST API for monitoring + settings (protected by JwtAuthGuard)

database/
└── entities/
    ├── position.entity.ts           ← open/closed positions
    ├── trade-log.entity.ts          ← trade history
    ├── trading-settings.entity.ts   ← per-mode trading parameters
    └── user.entity.ts               ← user credentials table

dashboard/                           ← Vite + React UI (port 5173)
```

---

## Setup

```bash
# 1. Install dependencies
npm run install:all

# 2. Configure environment
cp .env.example .env
# Fill in: BINANCE_API_KEY, BINANCE_DEMO_API_KEY, DB_*, TELEGRAM_BOT_TOKEN etc.

# 3. Start PostgreSQL
docker compose up -d
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

## Configuration

Trading parameters (symbol, leverage, SL/TP, EMA periods, etc.) are stored per-mode in PostgreSQL and editable via the dashboard **Settings** tab — no `.env` changes needed.

The `.env` file only requires:

| Variable | Purpose |
|---|---|
| `BINANCE_API_KEY` / `BINANCE_API_SECRET` | Live trading (mainnet) |
| `BINANCE_DEMO_API_KEY` / `BINANCE_DEMO_API_SECRET` | Demo trading (`demo-fapi.binance.com`) |
| `DB_HOST`, `DB_USER`, `DB_PASSWORD`, `DB_NAME`, `DB_PORT` | PostgreSQL |
| `NOTIFY_CHANNEL`, `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID` | Notifications |
| `ADMIN_USERNAME` / `ADMIN_PASSWORD` | Admin dashboard credentials (defaults to `admin` / `admin1234`) |
| `JWT_SECRET` / `JWT_EXPIRY` | JWT token secret and expiration duration (default secret, expiry `24h`) |
| `PORT` | Bot API port (default 3000) |

---

## Modes

| Mode | Exchange | Orders |
|---|---|---|
| **Live** | `fapi.binance.com` (mainnet) | Real orders |
| **Sandbox** | `demo-fapi.binance.com` | Demo orders (no real funds) |

Both modes run concurrently with separate position/trade history in the database.

---

## CDC Action Zone V3 — 8 Zones

| Zone | Name | Color | Condition |
|---|---|---|---|
| 1 | Strong Bull | Lime | close > EMA12 > EMA26, both rising |
| 2 | Bull | Green | close > EMA12 > EMA26, one not rising |
| 3 | Weak Bull | Olive | close < EMA12 > EMA26, EMA12 rising |
| 4 | Caution Bull | Dark Green | close < EMA12 > EMA26, EMA12 falling |
| 5 | Weak Bear | Orange | close > EMA12 < EMA26, EMA12 rising |
| 6 | Bear | Red-Orange | close > EMA12 < EMA26, EMA12 falling |
| 7 | Strong Bear (w) | Red | close < EMA12 < EMA26, EMA12 rising |
| 8 | Strong Bear | Dark Red | close < EMA12 < EMA26, both falling |

**BUY signal**: zone 5–8 → 1–4  
**SELL signal**: zone 1–4 → 5–8

Signals are confirmed on candle close: the strategy loop drops the still-forming candle and evaluates the zone from the last **closed** candle only.

---

## Dashboard API

> [!IMPORTANT]
> All `/api/*` endpoints except `/api/auth/login` require authentication. Set `Authorization: Bearer <JWT_TOKEN>` in request headers.

| Endpoint | Method | Purpose |
|---|---|---|
| `POST /api/auth/login` | POST | Login with username and password, returns JWT token |
| `GET /api/status?mode=` | GET | Bot status, open positions, CDC zone, PnL (auth required) |
| `GET /api/trades?mode=` | GET | Full trade history (auth required) |
| `GET /api/candles?timeframe=` | GET | OHLCV + EMA/zone overlay data (auth required) |
| `GET /api/indicator` | GET | Latest CDC calculation (auth required) |
| `GET /api/settings` | GET | Settings for live + sandbox (auth required) |
| `PUT /api/settings/:mode` | PUT | Update settings for a mode (auth required) |
| `GET /api/health` | GET | Uptime check (auth required) |

---

## Timeframe Cron Schedule

`StrategyService` creates a dynamic cron job per mode/symbol at startup. Changing `timeframe` via the Settings tab (or `PUT /api/settings/:mode`) reschedules the job automatically — no restart required. Each job fires at candle open and evaluates the last **closed** candle:

| Timeframe | Cron Expression |
|---|---|
| 1m | `* * * * *` |
| 5m | `*/5 * * * *` |
| 15m | `*/15 * * * *` |
| 1h | `0 * * * *` |
| 4h | `0 */4 * * *` |
| 1d | `0 0 * * *` |

---

## Risk Warning

⚠️ Always test with **Demo mode** before trading with real funds. Use `BINANCE_DEMO_API_KEY` from [demo-fapi.binance.com](https://demo-fapi.binance.com).
