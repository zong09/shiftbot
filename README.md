# CDC Action Zone V3 Trading Bot

NestJS trading bot for Binance Futures using the **CDC Action Zone V3 2020** indicator.

---

## Project Structure

```
src/
├── config/configuration.ts          ← .env → typed config (Binance keys, DB, JWT, admin, encryption key)
├── common/
│   ├── types/index.ts               ← shared interfaces and enums
│   └── crypto.util.ts               ← AES-256-GCM encrypt/decrypt for secrets stored in the DB
├── modules/
│   ├── market-data/                 ← Binance OHLCV: REST backfill + kline WebSocket (3 exchange instances)
│   ├── indicators/                  ← CDC Action Zone V3 calculation
│   ├── trading/                     ← open/close long & short + native exchange SL/TP orders
│   ├── trading-settings/            ← per-(mode, symbol) settings CRUD (PostgreSQL)
│   ├── notification/                ← LINE + Telegram senders, inbound LINE webhook
│   ├── notification-settings/       ← per-mode channel config, secret encrypt / decrypt / mask
│   ├── strategy/                    ← main trading loop + cron scheduler (one job per pair)
│   ├── auth/                        ← JWT authentication (login & api guard)
│   └── dashboard/                   ← REST API for monitoring + settings (protected by JwtAuthGuard)
└── database/
    ├── entities/
    │   ├── position.entity.ts              ← open/closed positions
    │   ├── trade-log.entity.ts             ← trade history
    │   ├── trading-settings.entity.ts      ← per-(mode, symbol) trading parameters
    │   ├── notification-settings.entity.ts ← per-mode LINE + Telegram config (secrets encrypted)
    │   └── user.entity.ts                  ← user credentials table
    └── migrations/                         ← TypeORM migrations, run automatically on every boot

dashboard/                           ← Vite + React UI (port 5173; bundled and served by the bot in production)
```

---

## Setup

```bash
# 1. Install dependencies
npm run install:all

# 2. Configure environment
cp .env.example .env
# Fill in: BINANCE_API_KEY, BINANCE_DEMO_API_KEY, DB_*, and the three
# secrets the bot refuses to boot without (see Configuration below)

# 3. Start PostgreSQL
docker compose up -d
```

## Running

```bash
# Development — bot + dashboard together (hot reload)
npm run dev
# → Bot API:  http://localhost:3001
# → Dashboard: http://localhost:5173

# Bot only
npm run start:dev

# Production — one deployable: the bot serves the built dashboard itself
npm run build && npm start

# Tests
npm test
```

---

## Configuration

Trading parameters (symbol, leverage, SL/TP, EMA periods, etc.) live in PostgreSQL keyed by **(mode, symbol)** and are editable in the dashboard **Settings** tab — no `.env` changes needed. Each mode can run several symbols at once, each with its own settings row and its own cron job.

`.env` holds only infrastructure and credentials:

| Variable | Purpose |
|---|---|
| `JWT_SECRET` | **Required** — boot throws if unset or under 32 chars. `openssl rand -hex 32` |
| `TOKEN_ENCRYPTION_KEY` | **Required** — boot throws unless exactly 64 hex chars. AES-256-GCM key for every secret in `notification_settings`. Never reuse `JWT_SECRET` |
| `ADMIN_PASSWORD` | **Required** — first-run admin seeding throws if unset, still `admin1234`, or under 8 chars |
| `BINANCE_API_KEY` / `BINANCE_API_SECRET` | Live trading (mainnet). Absent or placeholder ⇒ live mode is disabled entirely and only `sandbox` gets cron jobs |
| `BINANCE_DEMO_API_KEY` / `BINANCE_DEMO_API_SECRET` | Demo trading (`demo-fapi.binance.com`) |
| `DB_HOST`, `DB_USER`, `DB_PASSWORD`, `DB_NAME`, `DB_PORT` | PostgreSQL |
| `DATABASE_URL` | Optional — takes priority over the `DB_*` vars; SSL auto-enables in production or for a Railway/Supabase/Neon host |
| `DB_SSL_REJECT_UNAUTHORIZED=false` | Optional — for a DB with a self-signed cert |
| `DASHBOARD_ORIGIN` | Optional, comma-separated CORS allowlist. Unset in production **fails closed** (the dashboard is same-origin anyway); permissive in dev |
| `ADMIN_USERNAME` | Admin login name (default `admin`) |
| `JWT_EXPIRY` | Token lifetime (default `24h`) |
| `PORT` | Bot API port (default 3001) |

Notifications need **no** env vars — see below. Migrations run at every boot in dev and production alike.

---

## Modes

| Mode | Exchange | Orders |
|---|---|---|
| **Live** | `fapi.binance.com` (mainnet) | Real orders |
| **Sandbox** | `demo-fapi.binance.com` | Demo orders (no real funds) |

Both modes run concurrently with separate position/trade history in the database.

---

## Notifications — LINE + Telegram

Both channels are configured **per mode** under dashboard → Settings → การแจ้งเตือน and stored in `notification_settings`. There are **no notification env vars**: every credential lives in the database, encrypted with `TOKEN_ENCRYPTION_KEY`. Each channel keeps its own enable switch and its own set of event flags, so a channel that is off, unconfigured, or failing never suppresses the other.

Pasted values are trimmed on save — a trailing newline off the clipboard is invisible in the form but reaches the `Authorization` header and comes back as an unexplained 401. A failed test send shows the provider's own reason in the panel rather than a bare status code.

### LINE

| Field | Where to get it |
|---|---|
| CHANNEL ACCESS TOKEN | LINE Developers Console → your channel → **Messaging API** → *Channel access token (long-lived)* → Issue |
| CHANNEL SECRET | **Basic settings** → *Channel secret* — needed only for the inbound webhook |
| USER ID | **Basic settings** → *Your user ID*, for 1:1 messages. Add the bot as a friend via the QR code on the Messaging API tab first |
| GROUP ID | Discovered through the webhook (below). Takes **priority** over USER ID when both are set |
| WEBHOOK URL | Read-only in the dashboard — it is computed, copy it into the console |

Pushing a message needs only the **access token** plus a **GROUP ID or USER ID**. The webhook exists solely to discover a group id, so 1:1 notifications work without ever touching it.

**To notify a group:**

1. Paste the channel secret into the mode you intend to use and **save it first**. `POST /api/line/webhook/:mode` verifies `x-line-signature` against the stored secret, so the console's **Verify** button returns 401 until it is there — and `:mode` matters: a URL ending in `/live` while only the sandbox row holds a secret rejects everything.
2. Copy the read-only WEBHOOK URL into the console (Messaging API → Webhook URL), hit **Verify**, then switch **Use webhook** on.
3. In the LINE Official Account Manager: allow the bot to join group chats, and turn auto-reply and greeting messages off.
4. Invite the bot to the group. On the `join` event it replies with the group id — paste that into GROUP ID and save. The bot never writes the id itself, which would silently clobber a configured target.

### Telegram

BOT TOKEN from [@BotFather](https://t.me/BotFather), CHAT ID of the destination chat, and an optional MESSAGE THREAD ID to target a topic inside a forum-style group.

> [!NOTE]
> The daily-summary checkboxes are stored and shown in the UI but have no sender — there is no daily-summary cron yet.

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
> All `/api/*` endpoints require `Authorization: Bearer <JWT_TOKEN>`, except `/api/auth/login` and `/api/line/webhook/:mode` — the latter is authenticated by LINE's `x-line-signature` HMAC instead.

| Endpoint | Purpose |
|---|---|
| `POST /api/auth/login` | Login with username and password, returns a JWT (rate-limited: 5/min) |
| `GET /api/status?mode=` | Per-pair status (zone, positions, PnL); also triggers a position sync |
| `GET /api/trades?mode=&symbol=` | Trade history, optionally filtered by symbol |
| `GET /api/candles?timeframe=&symbol=` | OHLCV + CDC indicator overlay for the chart |
| `GET /api/indicator?symbol=` | Latest CDC calculation on demand |
| `GET /api/settings` | Settings for both modes, grouped |
| `GET /api/settings/:mode` | Every pair's settings for one mode |
| `PUT /api/settings/:mode` | Update an existing pair (body includes `symbol`); 404s if the pair does not exist yet |
| `POST /api/settings/:mode/pairs` | Add a symbol to a mode — creates the settings row *and* its cron job |
| `DELETE /api/settings/:mode/pairs?symbol=` | Remove a pair — refuses while positions are still open |
| `POST /api/positions/:id/close` | Manually market-close a single position by id |
| `GET /api/settings/notifications/:mode` | Per-mode LINE + Telegram config, every secret masked |
| `PUT /api/settings/notifications/:mode` | Update notification config; an omitted secret leaves the stored one alone |
| `POST /api/settings/notifications/:mode/test?channel=line\|telegram` | Send a real test push on one channel |
| `POST /api/line/webhook/:mode` | Inbound LINE webhook — **public**, verified by HMAC signature |
| `GET /api/health` | Uptime check |

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
