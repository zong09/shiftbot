import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import * as ccxt from "ccxt";
import * as WebSocket from "ws";
import { OHLCV } from "../../common/types";

@Injectable()
export class MarketDataService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(MarketDataService.name);
  private exchangeLive: ccxt.binanceusdm;
  private exchangeDemo: ccxt.binanceusdm;
  private exchangePublic: ccxt.binanceusdm; // no-auth — for OHLCV/ticker (public endpoints)
  private liveEnabled = false;

  constructor(private configService: ConfigService) {}

  /** A key is usable only if present and not a placeholder (.env.example default starts with "your_"). */
  private isConfigured(key?: string): boolean {
    return !!key && !key.startsWith("your_");
  }

  isLiveEnabled(): boolean {
    return this.liveEnabled;
  }

  async onModuleInit() {
    const liveKey = this.configService.get<string>("binance.apiKey");
    const liveSecret = this.configService.get<string>("binance.apiSecret");
    const demoKey = this.configService.get<string>("binance.demoApiKey");
    const demoSecret = this.configService.get<string>("binance.demoApiSecret");

    this.liveEnabled = this.isConfigured(liveKey);

    this.logger.log(
      `[Live] API key loaded: ${liveKey?.substring(0, 8) ?? "(none)"}...`,
    );
    this.logger.log(
      `[Demo] API key loaded: ${demoKey?.substring(0, 8) ?? "(none)"}...`,
    );

    this.exchangeLive = new ccxt.binanceusdm({
      apiKey: liveKey,
      secret: liveSecret,
      enableRateLimit: true,
      options: { defaultType: "future" },
    });

    this.exchangeDemo = new ccxt.binanceusdm({
      apiKey: demoKey,
      secret: demoSecret,
      enableRateLimit: true,
      options: { defaultType: "future" },
    });
    // Binance Demo Trading uses demo-fapi.binance.com (urls.demo in ccxt).
    // Use the official enableDemoTrading(true) — it swaps every host (fapi,
    // public, sapi) to the demo equivalents. A manual fapi-only string replace
    // leaves other hosts pointing at mainnet and Binance rejects the key (-2008).
    // NOTE: do NOT use setSandboxMode(true) — that points to testnet.binancefuture.com (deprecated).
    this.exchangeDemo.enableDemoTrading(true);

    const endpoint =
      (this.exchangeDemo.urls.api as Record<string, string>)?.["fapiPrivate"] ??
      "(unknown)";
    this.logger.log(`[Demo] endpoint → ${endpoint}`);

    this.exchangePublic = new ccxt.binanceusdm({
      enableRateLimit: true,
      options: { defaultType: "future" },
    });

    try {
      await this.exchangePublic.loadMarkets();
      this.logger.log("[Public] โหลด markets สำเร็จ");
    } catch (err) {
      this.logger.error("[Public] loadMarkets ไม่ได้: " + err.message);
    }

    if (this.liveEnabled) {
      try {
        await this.exchangeLive.loadMarkets();
        this.logger.log("[Live] เชื่อมต่อ Binance Futures สำเร็จ");
      } catch (err) {
        this.logger.error("[Live] เชื่อมต่อ Binance ไม่ได้: " + err.message);
      }
    } else {
      this.logger.warn("[Live] disabled — ไม่มี API key (รันเฉพาะ sandbox)");
    }
  }

  private wsConnections = new Map<string, WebSocket>();
  private wsCandles = new Map<string, OHLCV[]>();
  private wsPromises = new Map<string, Promise<OHLCV[]>>();
  private wsLastMessageAt = new Map<string, number>();
  private wsWatchdogs = new Map<string, NodeJS.Timeout>();
  // Keys whose stream was closed on purpose — their 'close' event must not trigger a reconnect
  private wsStopped = new Set<string>();
  // ไม่มี kline update เข้ามาเกินนี้ถือว่า socket ตาย (สมมติฐาน: symbol ที่ subscribe มี volume ซื้อขายต่อเนื่อง)
  private static readonly WS_STALE_MS = 60_000;

  async fetchOHLCV(limit = 200, symbol = "BTC/USDT:USDT"): Promise<OHLCV[]> {
    return this.fetchOHLCVByTimeframe(limit, "1h", symbol);
  }

  async fetchOHLCVByTimeframe(
    limit = 200,
    timeframe = "1h",
    symbol = "BTC/USDT:USDT",
  ): Promise<OHLCV[]> {
    return this.subscribeToKlineStream(symbol, timeframe, limit);
  }

  private async fetchRestCandles(symbol: string, timeframe: string, limit = 200): Promise<OHLCV[]> {
    const exchange = this.liveEnabled ? this.exchangeLive : this.exchangePublic;
    const raw = await exchange.fetchOHLCV(symbol, timeframe, undefined, limit);
    return raw.map(([timestamp, open, high, low, close, volume]) => ({
      timestamp: timestamp as number,
      open: open as number,
      high: high as number,
      low: low as number,
      close: close as number,
      volume: volume as number,
    }));
  }

  private static readonly TIMEFRAME_MS: Record<string, number> = {
    '1m': 60_000, '5m': 300_000, '15m': 900_000, '30m': 1_800_000,
    '1h': 3_600_000, '4h': 14_400_000, '1d': 86_400_000,
  };

  /** Cache is usable when it has history and the newest candle is at most 2 timeframes old. */
  private isCacheUsable(candles: OHLCV[] | undefined, timeframe: string): boolean {
    if (!candles || candles.length < 2) return false;
    const tfMs = MarketDataService.TIMEFRAME_MS[timeframe] ?? 3_600_000;
    const last = candles[candles.length - 1];
    return Date.now() - last.timestamp <= 2 * tfMs;
  }

  private async subscribeToKlineStream(symbol: string, timeframe: string, limit = 200): Promise<OHLCV[]> {
    const cacheKey = `${symbol}:${timeframe}`;

    // Return the cache only while it is populated AND fresh — a stale cache
    // (WS + backfill both down) must not silently feed the strategy.
    const existingCandles = this.wsCandles.get(cacheKey);
    if (this.isCacheUsable(existingCandles, timeframe)) {
      return existingCandles;
    }

    // If a REST (re)fetch is already in progress, wait for it
    const existingPromise = this.wsPromises.get(cacheKey);
    if (existingPromise) {
      return existingPromise;
    }

    const fetchPromise = (async () => {
      try {
        const data = await this.fetchRestCandles(symbol, timeframe, limit);
        if (!data.length) {
          // Do NOT cache an empty result — it would block WS seeding and
          // short-circuit every later call with [] forever.
          this.logger.warn(`Empty OHLCV response for ${cacheKey} — will retry on next call`);
          return [];
        }
        this.wsCandles.set(cacheKey, data);

        // Start the WebSocket connection for future real-time updates
        this.initWebSocket(symbol, timeframe);

        return data;
      } catch (err) {
        this.logger.error(`REST fetch failed for ${cacheKey}: ${err.message}`);
        return [];
      } finally {
        // Always clear so the next call can retry instead of reusing a settled promise
        this.wsPromises.delete(cacheKey);
      }
    })();

    this.wsPromises.set(cacheKey, fetchPromise);
    return fetchPromise;
  }

  /** Close one stream on purpose — its 'close' event will not reconnect. */
  private closeStream(cacheKey: string): void {
    this.wsStopped.add(cacheKey);
    const ws = this.wsConnections.get(cacheKey);
    this.wsConnections.delete(cacheKey);
    const watchdog = this.wsWatchdogs.get(cacheKey);
    if (watchdog) clearInterval(watchdog);
    this.wsWatchdogs.delete(cacheKey);
    this.wsLastMessageAt.delete(cacheKey);
    this.wsPromises.delete(cacheKey);
    try {
      ws?.terminate();
    } catch {
      // socket already dead
    }
  }

  /** Close every stream (all timeframes) and drop cached candles for a symbol no mode uses anymore. */
  closeStreamsForSymbol(symbol: string): void {
    const prefix = `${symbol}:`;
    for (const key of Array.from(this.wsConnections.keys())) {
      if (key.startsWith(prefix)) {
        this.closeStream(key);
        this.logger.log(`[WebSocket] closed stream ${key} (pair removed)`);
      }
    }
    for (const key of Array.from(this.wsCandles.keys())) {
      if (key.startsWith(prefix)) this.wsCandles.delete(key);
    }
  }

  onModuleDestroy(): void {
    for (const key of Array.from(this.wsConnections.keys())) {
      this.closeStream(key);
    }
  }

  private async reconnectWithBackfill(symbol: string, timeframe: string) {
    const cacheKey = `${symbol}:${timeframe}`;
    if (this.wsStopped.has(cacheKey)) return;
    try {
      const data = await this.fetchRestCandles(symbol, timeframe);
      this.wsCandles.set(cacheKey, data);
      this.logger.log(`[WebSocket] Backfilled ${data.length} candles for ${cacheKey} after reconnect`);
    } catch (err) {
      this.logger.error(`[WebSocket] Backfill failed for ${cacheKey}: ${err.message}`);
    }
    this.initWebSocket(symbol, timeframe);
  }

  private initWebSocket(symbol: string, timeframe: string) {
    const cacheKey = `${symbol}:${timeframe}`;
    if (this.wsConnections.has(cacheKey)) {
       return; // Already connected
    }
    // A fresh subscription revives a previously stopped key
    this.wsStopped.delete(cacheKey);

    const wsSymbol = symbol.split(':')[0].replace('/', '').toLowerCase();
    // Binance WS endpoint split (2026-04-23): kline streams moved under /market —
    // the legacy /ws path still accepts connections but never pushes market data.
    const wsUrl = `wss://fstream.binance.com/market/ws/${wsSymbol}@kline_${timeframe}`;

    const ws = new WebSocket(wsUrl);
    this.wsConnections.set(cacheKey, ws);
    this.wsLastMessageAt.set(cacheKey, Date.now());

    ws.on('open', () => {
      this.logger.log(`[WebSocket] Connected to ${wsSymbol}@kline_${timeframe}`);
      this.wsLastMessageAt.set(cacheKey, Date.now());
    });

    ws.on('message', (data: WebSocket.Data) => {
      this.wsLastMessageAt.set(cacheKey, Date.now());
      try {
        const payload = JSON.parse(data.toString());
        if (payload.e === 'kline' && payload.k) {
          const k = payload.k;
          const kline: OHLCV = {
            timestamp: k.t,
            open: parseFloat(k.o),
            high: parseFloat(k.h),
            low: parseFloat(k.l),
            close: parseFloat(k.c),
            volume: parseFloat(k.v),
          };

          const candles = this.wsCandles.get(cacheKey);
          if (candles && candles.length > 0) {
            const lastCandle = candles[candles.length - 1];
            if (lastCandle.timestamp === kline.timestamp) {
              // Update the current unclosed candle
              candles[candles.length - 1] = kline;
            } else if (kline.timestamp > lastCandle.timestamp) {
              // A new candle has started, push it and remove the oldest to maintain size
              candles.push(kline);
              if (candles.length > 200) {
                candles.shift();
              }
            }
          }
        }
      } catch (err) {
        // Ignore parsing errors
      }
    });

    ws.on('close', () => {
      this.wsConnections.delete(cacheKey);
      const watchdog = this.wsWatchdogs.get(cacheKey);
      if (watchdog) clearInterval(watchdog);
      this.wsWatchdogs.delete(cacheKey);
      if (this.wsStopped.has(cacheKey)) return; // closed on purpose — no reconnect
      this.logger.warn(`[WebSocket] Disconnected from ${wsSymbol}@kline_${timeframe}, reconnecting...`);
      setTimeout(() => this.reconnectWithBackfill(symbol, timeframe), 5000);
    });

    ws.on('error', (err) => {
      this.logger.error(`[WebSocket] Error on ${wsSymbol}@kline_${timeframe}: ${err.message}`);
      ws.close();
    });

    const watchdog = setInterval(() => {
      const lastMessageAt = this.wsLastMessageAt.get(cacheKey) ?? 0;
      if (Date.now() - lastMessageAt > MarketDataService.WS_STALE_MS) {
        this.logger.warn(`[WebSocket] ${wsSymbol}@kline_${timeframe} idle > ${MarketDataService.WS_STALE_MS}ms — forcing reconnect`);
        ws.terminate();
      }
    }, 15_000);
    this.wsWatchdogs.set(cacheKey, watchdog);
  }

  async fetchTicker(
    symbol = "BTC/USDT:USDT",
  ): Promise<{ bid: number; ask: number; last: number }> {
    const ticker = await this.exchangePublic.fetchTicker(symbol);
    return { bid: ticker.bid, ask: ticker.ask, last: ticker.last };
  }

  async fetchBalance(
    mode: "live" | "sandbox" = "live",
  ): Promise<{ total: number; free: number; used: number }> {
    const exchange = this.getExchange(mode);
    // Use raw /fapi/v3/balance — ccxt fetchBalance() maps fields incorrectly for USDM futures
    // Response is array: [{asset, balance, availableBalance, ...}]
    const raw = await (exchange as any).fapiPrivateV3GetBalance({});
    const usdt = Array.isArray(raw)
      ? raw.find((b: any) => b.asset === "USDT")
      : undefined;
    const total = parseFloat(usdt?.balance ?? "0");
    const free = parseFloat(usdt?.availableBalance ?? "0");
    return { total, free, used: total - free };
  }

  getExchange(mode: "live" | "sandbox" = "live"): ccxt.binanceusdm {
    return mode === "sandbox" ? this.exchangeDemo : this.exchangeLive;
  }
}
