# ShiftBot — Security & Bug Fix Plan

> Generated 2026-07-23 from a full review of `src/` and `dashboard/`.
> Tasks are sized for delegation to a junior/LLM worker (qwen): each task is
> self-contained, names exact files/lines, and has verifiable acceptance criteria.
> Line numbers reference the current `main` branch (commit `cc296eb`).
>
> **Order matters**: do T1 → T2 → T3 first (money-safety), then the rest in any order.
> After every task: `npm run build` must pass and `npx jest` must stay green (104 tests).

## Findings summary

| # | Severity | Area | Issue |
|---|----------|------|-------|
| T1 | **HIGH** | trading | Close path cancels SL/TP *before* the market close — a failed close leaves a live position with **no exchange-side protection** |
| T2 | **HIGH** | trading | `syncPositions` has no concurrency guard — dashboard poll + strategy cron can both record the same close → **duplicate SYNC_CLOSE logs, PnL counted twice** |
| T3 | **HIGH** | trading | `closeLong`/`closeShort` record PnL from the *ticker* price, not the actual close-order fill price → ledger inaccurate |
| T4 | MEDIUM | strategy | Pairs with `status: 'off'` skip `syncPositions` entirely — DB never learns about exchange-side closes for those pairs |
| T5 | MEDIUM | settings | `PUT /api/settings/:mode` with an unknown symbol silently **creates** a settings row via upsert, with no cron job scheduled for it |
| T6 | MEDIUM | market-data | WS candle cache freshness check ignores **gaps** — a missed kline leaves a hole in history and skews EMA/zone calculation |
| T7 | MEDIUM | security | CORS reflects any origin when `DASHBOARD_ORIGIN` is unset — should fail closed in production |
| T8 | LOW | security | `POST /api/positions/:id/close` doesn't validate UUID → malformed id becomes a 500 (Postgres cast error) instead of 400 |
| T9 | LOW | security | First 8 chars of Binance API keys are written to logs |
| T10 | LOW | notification | `sendError` interpolates raw error text into Telegram `parse_mode: 'Markdown'` — unbalanced `*`/`_` in the message makes Telegram reject the notification |
| T11 | LOW | strategy | Failed close → retry next candle re-sends the BUY/SELL notification (duplicate alerts) |
| T12 | DOC | docs | Port defaults inconsistent: `main.ts` falls back to 3001, `configuration.ts` says 3000, CLAUDE.md says 3000 |
| T13 | **HIGH** | trading | No lock between manual close (`closePositionById`/`closeAllPositions`) and cron-driven close — double order submission + duplicate trade-log rows |
| T14 | MEDIUM | trading | `maxPositions > 1` breaks `syncPositions`: Binance one-way mode nets same-side legs into one position, so a filled leg's DB row never gets marked closed |
| T15 | MEDIUM | trading | `placeProtectiveOrders` silently accepts one-sided protection (SL ok, TP failed or vice versa) — only logged, never alerted or retried |
| T16 | LOW | settings | `getSettings` find-then-create race on composite PK (mode,symbol) → unhandled unique-violation under concurrency |
| T17 | LOW | strategy | Post-restart zone reconstruction slice is one candle short at the minimum-data boundary → first signal after restart swallowed as HOLD |
| T18 | LOW | strategy | Two independent `TIMEFRAME_MS` maps (strategy vs market-data) can drift |
| T19 | LOW | security | Username enumeration via bcrypt timing side-channel in `validateUser` |
| T20 | LOW | security | `GET /api/indicator` + `/api/candles` accept free-text `symbol`/`timeframe` → each distinct combo opens a real outbound WebSocket + watchdog (resource exhaustion by an authenticated caller) |
| T21 | MEDIUM | dashboard | Axios interceptor registered on the **global** axios instance — any future external request would leak the JWT to third parties |
| T22 | MEDIUM | dashboard | `onRemovePair` is fire-and-forget with no try/catch — a failed pair delete shows no error to the user |
| T23 | LOW | dashboard | Settings form sends `0` when a numeric field is cleared (`Number('')` → `0`); backend DTO rejects it but the user just sees a raw 400 |

Known accepted tradeoffs (no task): JWT stored in `localStorage` (XSS exposure — standard SPA tradeoff, mitigated by no `dangerouslySetInnerHTML` anywhere); no JWT revocation list (single-admin app, 24h expiry); `fetchTicker` always uses the public mainnet endpoint even in sandbox mode (demo prices track mainnet closely).

---

## T1 — Re-order close path: market-close FIRST, cancel SL/TP after 🔴 HIGH

**File**: `src/modules/trading/trading.service.ts`
**Methods**: `closeLong` (lines ~360–365) and `closeShort` (lines ~496–500)

**Problem**: Both methods run `cancelProtectiveOrders` → `createMarketSell/BuyOrder`. If the market close throws (network error, exchange hiccup), the catch returns `false` and the position stays `open` in DB — but its STOP_MARKET/TAKE_PROFIT_MARKET orders were already cancelled. Until the next signal retries, a live leveraged position sits on Binance with **no stop loss**.

**Change** (identical in both methods):
1. Swap the two calls: place the reduceOnly market close order **first**, then call `this.cancelProtectiveOrders(exchange, position, mode)` after it succeeds.
2. Keep everything else identical. If the close throws, the catch path is unchanged (returns `false`) — but now SL/TP survive, so the position is still protected.
3. Leftover siblings after a successful close are already handled: `cancelProtectiveOrders` runs right after, and `sweepStaleProtectiveOrders` catches any cancel failure before the next entry.

**Do NOT** change `cancelProtectiveOrders` itself or the sweep logic.

**Acceptance**:
- In both `closeLong` and `closeShort`, `createMarket*Order` appears before `cancelProtectiveOrders`.
- Update any unit test in `src/modules/trading/*.spec.ts` that asserts the old call order (search for `cancelOrder` mock ordering).
- `npm run build` + `npx jest` green.

---

## T2 — Make `syncPositions` close-once (guard against concurrent sync) 🔴 HIGH

**File**: `src/modules/trading/trading.service.ts`, method `syncPositions` (lines ~597–672)

**Problem**: `syncPositions` is called concurrently from (a) the strategy cron (`strategy.service.ts:144`) and (b) every dashboard `GET /api/status` poll (`dashboard.controller.ts:31`). Two overlapping runs can both see the same local position as closed-on-exchange and both insert a `SYNC_CLOSE` trade log → PnL counted twice in `getTotalPnl`.

**Change** — use an atomic conditional update as the gate:
1. Inside the `if (isClosed)` block, replace the unconditional
   ```ts
   await this.positionRepo.update(localPos.id, { status: 'closed', closeTime: new Date(), closedPnl: pnl });
   ```
   with a conditional update **executed BEFORE computing PnL**, then early-continue when another run already claimed it:
   ```ts
   const claim = await this.positionRepo.update(
     { id: localPos.id, status: 'open' },
     { status: 'closed', closeTime: new Date() },
   );
   if (!claim.affected) continue; // another concurrent sync already handled this position
   ```
2. After the claim succeeds, compute `pnl` exactly as today (income endpoint → mark-price fallback), then persist it with a second update: `await this.positionRepo.update(localPos.id, { closedPnl: pnl });`
3. Trade-log insert + notification stay where they are (after the claim), so they run at most once.
4. Move `cancelProtectiveOrders` to after the successful claim too (no reason to cancel siblings if another run owns the close).

**Acceptance**:
- `positionRepo.update` is called with the `{ id, status: 'open' }` criteria object and the code `continue`s when `affected` is 0/undefined.
- Add a unit test: mock `positionRepo.update` to return `{ affected: 0 }` → assert `tradeLogRepo.save` and `notificationService.sendClosePosition` are NOT called.
- `npm run build` + `npx jest` green.

---

## T3 — Record close PnL from the actual fill price 🔴 HIGH

**File**: `src/modules/trading/trading.service.ts`, methods `closeLong` (~363–367) and `closeShort` (~498–502)

**Problem**: The close order's response is discarded; PnL uses the `currentPrice` argument (ticker snapshot or even `entryPrice` fallback from `closeAllPositions`). Slippage makes the ledger wrong.

**Change** (identical pattern in both methods):
1. Capture the order result: `const order = await exchange.createMarketSellOrder(...)` (buy for short).
2. Derive the exit price: `const exitPrice = order.average ?? currentPrice;`
3. Use `exitPrice` instead of `currentPrice` in: the `pnl` calculation, the trade-log `price` field, the log line, and the `sendClosePosition(..., exitPrice)` call.

**Acceptance**:
- `order.average` is used with `currentPrice` as fallback in both methods.
- Adjust existing close-path unit tests: mock order result with `average` set and assert PnL uses it.
- `npm run build` + `npx jest` green.

---

## T4 — Sync positions even when pair status is 'off' 🟠 MEDIUM

**File**: `src/modules/strategy/strategy.service.ts`, method `runForPair` (lines ~136–144)

**Problem**: The `if (s.status === 'off') return;` check (line 138–141) runs *before* `await this.tradingService.syncPositions(mode, symbol);` (line 144). A pair switched off with (or after) open positions never reconciles exchange-side closes through the cron path.

**Change**: Move the `syncPositions` call (line 143–144, keep its comment) to *above* the `if (s.status === 'off')` block, i.e. right after `const s = await this.settingsService.getSettings(mode, symbol);`.

**Acceptance**:
- In `runForPair`, `syncPositions` executes before the `status === 'off'` early return.
- `npm run build` + `npx jest` green (update `strategy.service.spec.ts` if it asserts call order).

---

## T5 — Reject settings update for a symbol that doesn't exist 🟠 MEDIUM

**Files**:
- `src/modules/trading-settings/trading-settings.service.ts`, method `updateSettings` (lines 46–53)

**Problem**: `repo.upsert({ mode, symbol, ...dto })` inserts a brand-new row when the (mode, symbol) pair was never added. That phantom pair has no cron job (jobs are only created via `addPair`/`reschedule`) and shows up in the dashboard unexpectedly. Pair creation must stay exclusive to `POST /settings/:mode/pairs`.

**Change**:
1. In `updateSettings`, first `const existing = await this.repo.findOne({ where: { mode, symbol } });`
2. If not found: `throw new NotFoundException(\`no settings for ${mode}/${symbol} — add the pair first\`);` (import `NotFoundException` from `@nestjs/common`).
3. Replace the `upsert` with `await this.repo.update({ mode, symbol }, dto);` and keep the final `return this.getSettings(mode, symbol);`

**Acceptance**:
- `PUT /api/settings/live` with body `{ "symbol": "DOGE/USDT:USDT" }` (never added) returns 404, and no new row appears in `trading_settings`.
- Add a unit test for the NotFoundException path in `trading-settings.service.spec.ts` (create the spec if missing, mirroring the existing spec style).
- `npm run build` + `npx jest` green.

---

## T6 — Detect gaps in the WS candle cache 🟠 MEDIUM

**File**: `src/modules/market-data/market-data.service.ts`, method `isCacheUsable` (lines 131–136)

**Problem**: The cache is considered usable when the newest candle is < 2 timeframes old. If the WebSocket dropped messages (a candle boundary passed with no kline event), the array has a timestamp gap; EMA over a gapped series produces a wrong zone and can fire a wrong trade signal.

**Change**:
1. In `isCacheUsable`, after the existing freshness check, verify contiguity of the **last 30 candles** (bounded — no need to scan all 200):
   ```ts
   const start = Math.max(1, candles.length - 30);
   for (let i = start; i < candles.length; i++) {
     if (candles[i].timestamp - candles[i - 1].timestamp !== tfMs) return false;
   }
   ```
2. Returning `false` already triggers a full REST refetch via the existing `subscribeToKlineStream` flow — no other change needed.

**Acceptance**:
- Unit test in `market-data.service.spec.ts`: a candle array with one missing timeframe step in the last 30 entries makes the service refetch via REST (assert `fetchOHLCV` on the exchange mock is called) — and a contiguous array does not.
- `npm run build` + `npx jest` green.

---

## T7 — Fail-closed CORS in production 🟠 MEDIUM

**File**: `src/main.ts` (lines 11–15)

**Problem**: With `DASHBOARD_ORIGIN` unset, `origin: true` reflects every origin. Fine in local dev; in production it should not silently stay wide open.

**Change**:
```ts
const isProd = process.env.NODE_ENV === 'production';
const origins = process.env.DASHBOARD_ORIGIN?.split(',');
app.enableCors({
  // dev: permissive (Vite proxy handles same-origin); prod: require an explicit allowlist
  origin: origins ?? (isProd ? false : true),
});
```
If `isProd && !origins`, also `Logger.warn` one line at bootstrap saying CORS is disabled for cross-origin requests until `DASHBOARD_ORIGIN` is set. (Note `ServeStaticModule` serves the dashboard same-origin in prod, so `origin: false` does not break the bundled UI.)

**Acceptance**: `npm run build` green; behavior verified by reading the built code path (no test infra for main.ts bootstrap).

---

## T8 — Validate position id as UUID 🟢 LOW

**File**: `src/modules/dashboard/dashboard.controller.ts`, `closePosition` (lines 198–202)

**Change**: `@Param('id', ParseUUIDPipe) id: string` — import `ParseUUIDPipe` from `@nestjs/common`.

**Acceptance**: `POST /api/positions/not-a-uuid/close` returns 400 (not 500). Build + tests green.

---

## T9 — Stop logging API key prefixes 🟢 LOW

**File**: `src/modules/market-data/market-data.service.ts` (lines 34–39)

**Change**: Replace both log lines with presence booleans, e.g.
`this.logger.log(\`[Live] API key loaded: ${this.isConfigured(liveKey) ? 'yes' : 'no'}\`);` (same for Demo).

**Acceptance**: No substring of any key appears in logs. Build + tests green.

---

## T10 — Make error notifications Markdown-safe 🟢 LOW

**File**: `src/modules/notification/notification.service.ts`, `sendError` (lines 70–72) and `sendTelegram` (92–103)

**Problem**: Exchange error messages routinely contain `*`, `_`, `[` — Telegram rejects the whole message with 400 when `parse_mode: 'Markdown'` can't parse it, so the alert is silently lost (only a log line remains).

**Change** (minimal): keep `sendTelegram` as-is, but in `sendError`, strip Markdown-significant characters from the error text before composing the message: `const safe = message.replace(/[*_\[\]`]/g, '');` then `await this.send(\`⚠️ *Bot Error*\n${safe}\`);` (Keep the LINE path unchanged — it already strips `*`.)

**Acceptance**: Unit test: `sendError('boom *[weird_msg]*')` produces a Telegram payload whose `text` contains no `*`, `_`, `[`, `]`, or backtick characters after the "Bot Error" header line. Build + tests green.

---

## T11 — Don't re-send signal notification on close-retry 🟢 LOW

**File**: `src/modules/strategy/strategy.service.ts`, `runForPair` BUY branch (~182–186) and SELL branch (~214–218)

**Problem**: `sendSignal` fires at the top of the branch. When a close fails, `lastZone` is intentionally not advanced so the signal retries next candle — and the notification fires again each retry.

**Change**: Track the last notified transition per pair in `PairContext`: add `lastNotifiedSignalKey: string | null` to the interface (init `null` in both places contexts are created). Compute `const signalKey = \`${result.signal}->${result.zone}\`;` — only call `sendSignal` when `ctx.lastNotifiedSignalKey !== signalKey`, set it right after sending, and reset it to `null` whenever a candle produces `HOLD`.

**Acceptance**: Unit test: two consecutive `runForPair` calls that both produce BUY (close failing in the first) call `sendSignal` exactly once. Build + tests green.

---

## T12 — Align port documentation 📄 DOC

**Files**: `CLAUDE.md`, `src/config/configuration.ts` (line 13), `src/main.ts` (line 20)

**Problem**: `main.ts` defaults to **3001** (matching the Vite proxy at `dashboard/vite.config.mjs`), but `configuration.ts` has an unused `port: ... || 3000` and CLAUDE.md documents "Bot API: http://localhost:3000".

**Change** (docs-only, no behavior change):
1. `configuration.ts`: change the fallback `3000` → `3001` so the config value matches reality.
2. `CLAUDE.md`: replace the `localhost:3000` Bot API references with `localhost:3001` (including the `/api → localhost:3000` proxy note in Architecture).

**Acceptance**: `grep -rn 'localhost:3000' CLAUDE.md src/` returns nothing. Build green.

---

## T13 — Single-flight close per position (manual API vs cron race) 🔴 HIGH

**File**: `src/modules/trading/trading.service.ts`, methods `closeLong` (~351) and `closeShort` (~486)

**Problem**: `StrategyService` guards its own cron ticks with `ctx.isRunning`, but the dashboard's `POST /api/positions/:id/close` and `DELETE /settings/:mode/pairs` call `TradingService` directly with no shared lock. A cron-signal close and a manual close on the same position can interleave: both submit a reduceOnly market order, both write a trade log → duplicate rows, wasted/rejected orders, `closedPnl` overwritten by the slower writer.

**Change** — reuse the T2 atomic-claim pattern at the top of both close methods:
1. First statement inside the `try` block: atomically claim the position:
   ```ts
   const claim = await this.positionRepo.update(
     { id: position.id, status: 'open' },
     { status: 'closing' },
   );
   if (!claim.affected) {
     this.logger.warn(`[${mode}][${symbol}] position ${position.id} already being closed — skipped`);
     return true; // treat as success: another path owns the close
   }
   ```
2. Add `'closing'` to the allowed `status` values on `PositionEntity` (`src/database/entities/position.entity.ts`) and the `Position` type in `src/common/types` if the column/type is an enum or union; if it's a plain string column, no schema change needed.
3. On failure (the existing catch): roll the status back to `'open'` before returning `false`, so the retry path still finds it:
   ```ts
   await this.positionRepo.update({ id: position.id, status: 'closing' }, { status: 'open' });
   ```
4. The final success update (`status: 'closed'`) works unchanged — it updates by id.
5. Check every `where: { status: 'open' }` query in the file: `getOpenPositions`, `hasOpenPosition`, `openCount`, `sweepStaleProtectiveOrders`, `syncPositions` should continue to treat only `'open'` as open — a `'closing'` row is deliberately excluded (it is owned by an in-flight close). `closePositionById`'s post-close re-check (`updated.status !== 'closed'`) needs no change.

**Depends on**: do T1 and T2 first (same methods).

**Acceptance**:
- Unit test: mock `positionRepo.update` for the claim to return `{ affected: 0 }` → `closeLong` returns `true` and `exchange.createMarketSellOrder` is never called.
- Unit test: close-order throws → status rolled back to `'open'`.
- `npm run build` + `npx jest` green.

---

## T14 — Cap `maxPositions` at 1 until per-leg fill tracking exists 🟠 MEDIUM

**Files**:
- `src/modules/dashboard/dto/update-settings.dto.ts` (line ~43: `@Max(10)` on `maxPositions`)

**Problem**: Binance USDM one-way mode nets all same-side exposure into ONE exchange position. With `maxPositions=2`, two DB rows map to one netted position; when leg A's SL fills, `contracts` stays > 0 (leg B), so `syncPositions`' `isClosed` check never fires for leg A → its row stays `open` forever, blocking new entries and corrupting PnL. Proper per-leg tracking (polling `slOrderId`/`tpOrderId` fill status) is a feature, not a fix — constrain the config instead.

**Change**:
1. In `UpdateSettingsDto`, change `@Max(10)` → `@Max(1)` on `maxPositions`, with a comment: `// one-way mode nets same-side legs — >1 breaks syncPositions leg tracking`.
2. Leave defaults (already 1) and everything else untouched.

**Acceptance**: `PUT /api/settings/:mode` with `maxPositions: 2` returns 400. Build + tests green.

---

## T15 — Alert (and retry) when SL/TP placement partially fails 🟠 MEDIUM

**File**: `src/modules/trading/trading.service.ts`, `placeProtectiveOrders` (lines 137–175)

**Problem**: SL and TP are placed in two independent try/catches; a one-sided failure is only `logger.error`'d. A leveraged position can sit with no stop loss and the operator never knows unless they read logs.

**Change**:
1. Wrap each `createOrder` call in a small retry helper: try once, on failure wait ~2s and try once more (inline, no new dependency).
2. Add `private notificationService` usage: after both attempts fail for either order, and `mode === 'live'`, call `this.notificationService.sendError(...)` with a message naming the symbol and which protection is missing (SL or TP). `NotificationService` is already injected in the constructor.
3. Return shape unchanged (`{ slOrderId, tpOrderId }` with `null` for failed side).

**Acceptance**:
- Unit test: `createOrder` for SL rejects twice → `sendError` called once with a message containing the symbol; `slOrderId` is `null`, `tpOrderId` still set.
- `npm run build` + `npx jest` green.

---

## T16 — Make `getSettings` create path race-safe 🟢 LOW

**File**: `src/modules/trading-settings/trading-settings.service.ts`, `getSettings` (lines 25–31)

**Problem**: find-then-save on a composite PK `(mode, symbol)` — two concurrent first-time callers both insert; the loser throws an unhandled unique-violation.

**Change**: replace the `save` with an upsert-then-read:
```ts
async getSettings(mode: TradingMode, symbol: string): Promise<TradingSettingsEntity> {
  let row = await this.repo.findOne({ where: { mode, symbol } });
  if (!row) {
    await this.repo.upsert({ mode, symbol, ...defaultFields() }, ['mode', 'symbol']);
    row = await this.repo.findOne({ where: { mode, symbol } });
  }
  return row!;
}
```
(Note: this coexists with T5 — T5 removes the upsert from `updateSettings`, this adds one here where implicit creation IS the intended behavior.)

**Acceptance**: existing tests green; add one test that `getSettings` returns a row when `findOne` misses first then hits.

---

## T17 — Fix one-candle-short slice in restart zone reconstruction 🟢 LOW

**File**: `src/modules/strategy/strategy.service.ts`, lines 161–164

**Problem**: `calculate` needs `slowPeriod + 2` candles. When `confirmed.length === slowPeriod + 2` exactly, `confirmed.slice(0, -1)` has one too few → reconstruction returns `null` → `lastZone` stays `undefined` → the first real transition after a restart is emitted as HOLD.

**Change**: guard the reconstruction so it only runs when it can succeed, and log when it can't:
```ts
if (ctx.lastZone === undefined && confirmed.length > 1) {
  const prev = this.cdcService.calculate(confirmed.slice(0, -1), undefined, s.emaFast, s.emaSlow);
  if (prev) ctx.lastZone = prev.zone;
  else this.logger.warn(`[${mode}][${symbol}] ไม่พอ candle สำหรับ reconstruct lastZone (${confirmed.length - 1} แท่ง) — สัญญาณแรกหลัง restart อาจเป็น HOLD`);
}
```
This is detection+visibility only (fetch limit is 200, so the boundary case needs a brand-new listing/short history — rare). Do NOT change the fetch limit.

**Acceptance**: build + tests green; warn path covered by a unit test with exactly `slowPeriod + 2` confirmed candles.

---

## T18 — Consolidate `TIMEFRAME_MS` into one shared constant 🟢 LOW

**Files**: `src/modules/strategy/strategy.service.ts` (lines 26–33), `src/modules/market-data/market-data.service.ts` (lines 125–128), new file `src/common/timeframes.ts`

**Change**:
1. Create `src/common/timeframes.ts` exporting a single `TIMEFRAME_MS: Record<string, number>` containing the union of both maps (`1m 5m 15m 30m 1h 4h 1d`).
2. Import it in both services; delete the local copies (in market-data it's a `private static readonly` — replace references `MarketDataService.TIMEFRAME_MS` → imported constant).
3. `TIMEFRAME_CRON` stays where it is.

**Acceptance**: `grep -rn 'TIMEFRAME_MS' src/` shows one definition + imports only. Build + tests green.

---

## T19 — Equalize login timing on unknown username 🟢 LOW

**File**: `src/modules/auth/auth.service.ts`, `validateUser` (lines 53–60)

**Change**: when `findOne` misses, run a dummy compare before returning `null`:
```ts
const DUMMY_HASH = '$2a$10$CwTycUXWue0Thq9StjUM0uJ8ZzKpXGiJT2rDCBBB0mPZEK1bZDHhu'; // bcrypt of a throwaway string
...
if (!user) {
  await bcrypt.compare(pass, DUMMY_HASH); // equalize timing — prevent username enumeration
  return null;
}
```
Keep the existing happy path unchanged.

**Acceptance**: unit test asserting `bcrypt.compare` is called even when the user is not found. Build + tests green.

---

## T20 — Validate `symbol`/`timeframe` on GET indicator/candles 🟢 LOW

**File**: `src/modules/dashboard/dashboard.controller.ts` (`getIndicator` ~107, `getCandles` ~128)

**Problem**: free-text query params become WS cache keys — every distinct `symbol:timeframe` string opens a real outbound WebSocket + 15s watchdog interval. Authenticated-only, but easy resource exhaustion.

**Change**: reuse the constants already exported from `./dto/update-settings.dto` (`VALID_TIMEFRAMES`, `SYMBOL_PATTERN`). At the top of both handlers:
```ts
if (!SYMBOL_PATTERN.test(symbol)) throw new BadRequestException('invalid symbol');
if (timeframe && !VALID_TIMEFRAMES.includes(timeframe as any)) throw new BadRequestException('invalid timeframe');
```
(`getIndicator` has no timeframe param — symbol check only.)

**Acceptance**: `GET /api/candles?symbol=<junk>` and `?timeframe=2h` return 400; valid values still work. Build + tests green.

---

## T21 — Scope axios interceptors to a dedicated instance 🟠 MEDIUM

**File**: `dashboard/src/api.js`

**Problem**: interceptors are registered on the global `axios` default export. Any future `import axios from 'axios'` call to an external URL silently sends `Authorization: Bearer <JWT>` to that third party.

**Change**:
1. `const client = axios.create({ baseURL: BASE });`
2. Move both interceptors (`request` at lines 6–14, `response` at 17–27) onto `client`.
3. Rewrite every exported function to use `client` and drop the `${BASE}` prefix (e.g. `client.post('/auth/login', ...)`, `client.get(`/status?mode=${mode}`)`).
4. No component changes — the exported function signatures stay identical.

**Acceptance**: `grep -n 'axios\.' dashboard/src/api.js` shows only `axios.create`; dashboard login + data load still work (`npm run dev`, manual smoke). `cd dashboard && npm run build` green.

---

## T22 — Surface pair-removal failures in the UI 🟠 MEDIUM

**Files**: `dashboard/src/App.jsx` (`onRemovePair` prop, lines ~254–261), `dashboard/src/components/Settings.jsx` (the remove button handler, ~line 73)

**Problem**: `onRemovePair` is async with no try/catch and its caller fires it without `await`/`.catch()`. A failed delete (backend refuses while positions remain open — see `dashboard.controller.ts:179-184`) rejects unhandled: the pair silently stays with zero feedback.

**Change**: mirror the existing close-position pattern (`App.jsx:296–303`):
1. In `App.jsx`, wrap the `onRemovePair` body in try/catch; on error call `setError(\`ลบ pair ไม่สำเร็จ: ${err.response?.data?.message ?? err.message}\`)`.
2. In `Settings.jsx`, make the confirm-branch `await onRemove(mode, pair.symbol)` inside an async handler so rejections propagate to the App-level catch (or `.catch(() => {})` after App handles display — either way no unhandled rejection).

**Acceptance**: with the bot stopped, clicking remove shows the error banner instead of nothing. `cd dashboard && npm run build` green.

---

## T23 — Client-side validation for numeric settings fields 🟢 LOW

**File**: `dashboard/src/components/Settings.jsx` (numeric `Field` inputs, lines ~92–112)

**Problem**: clearing a numeric input then saving sends `Number('') === 0`; the backend DTO rejects it (`@Min`), but the user only sees a raw 400 error.

**Change**: before calling `onSave`, validate the form: every numeric field must be a finite number `> 0` (and `emaFast < emaSlow`, matching the backend rule). If invalid, show the existing inline error text (reuse whatever error display Save already has) and skip the request. Keep it minimal — no new validation library.

**Acceptance**: clearing "Leverage" and clicking Save shows an inline message and sends no request. `cd dashboard && npm run build` green.

---

## Suggested delegation batches

| Batch | Tasks | Why |
|-------|-------|-----|
| 1 (sequential, review each) | T1, T2, T3, T13 | Money-safety changes to the same file — do in order, re-run full test suite between each |
| 2 (parallel-safe) | T4, T5, T14, T15, T16, T17 | Trading/strategy/settings correctness, independent edits |
| 3 (parallel-safe) | T6, T7, T20, T21, T22 | Market-data, security hardening, dashboard reliability |
| 4 (parallel-safe, trivial) | T8, T9, T10, T12, T18, T19 | Small mechanical edits |
| 5 (optional) | T11, T23 | Nice-to-have UX polish |

Open question for the owner (not a task): the Settings UI has no input for `stopLossPct`/`takeProfitPct` even though the values live in form state — confirm whether SL/TP editing is intentionally dashboard-locked or a missing feature.
