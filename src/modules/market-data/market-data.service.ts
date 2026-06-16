import { Injectable, Logger, OnModuleInit } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import * as ccxt from "ccxt";
import { OHLCV } from "../../common/types";

@Injectable()
export class MarketDataService implements OnModuleInit {
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
      options: { defaultType: "future" },
    });

    this.exchangeDemo = new ccxt.binanceusdm({
      apiKey: demoKey,
      secret: demoSecret,
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

  async fetchOHLCV(limit = 200, symbol = "BTC/USDT:USDT"): Promise<OHLCV[]> {
    try {
      const raw = await this.exchangePublic.fetchOHLCV(
        symbol,
        "1h",
        undefined,
        limit,
      );
      return raw.map(([timestamp, open, high, low, close, volume]) => ({
        timestamp: timestamp as number,
        open: open as number,
        high: high as number,
        low: low as number,
        close: close as number,
        volume: volume as number,
      }));
    } catch (err) {
      this.logger.error(`fetchOHLCV(${symbol}) error: ` + err.message);
      return [];
    }
  }

  async fetchOHLCVByTimeframe(
    limit = 200,
    timeframe = "1h",
    symbol = "BTC/USDT:USDT",
  ): Promise<OHLCV[]> {
    try {
      const raw = await this.exchangePublic.fetchOHLCV(
        symbol,
        timeframe,
        undefined,
        limit,
      );
      return raw.map(([timestamp, open, high, low, close, volume]) => ({
        timestamp: timestamp as number,
        open: open as number,
        high: high as number,
        low: low as number,
        close: close as number,
        volume: volume as number,
      }));
    } catch (err) {
      this.logger.error(
        `fetchOHLCVByTimeframe(${timeframe}, ${symbol}) error: ` + err.message,
      );
      return [];
    }
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
