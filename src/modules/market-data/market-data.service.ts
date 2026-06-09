import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as ccxt from 'ccxt';
import { OHLCV } from '../../common/types';

@Injectable()
export class MarketDataService implements OnModuleInit {
  private readonly logger = new Logger(MarketDataService.name);
  private exchangeLive:   ccxt.binanceusdm;
  private exchangeDemo:   ccxt.binanceusdm;
  private exchangePublic: ccxt.binanceusdm; // no-auth — for OHLCV/ticker (public endpoints)

  constructor(private configService: ConfigService) {}

  async onModuleInit() {
    const liveKey    = this.configService.get<string>('binance.apiKey');
    const liveSecret = this.configService.get<string>('binance.apiSecret');
    const demoKey    = this.configService.get<string>('binance.demoApiKey');
    const demoSecret = this.configService.get<string>('binance.demoApiSecret');

    this.exchangeLive = new ccxt.binanceusdm({
      apiKey: liveKey,
      secret: liveSecret,
      options: { defaultType: 'future' },
    });

    this.exchangeDemo = new ccxt.binanceusdm({
      apiKey: demoKey,
      secret: demoSecret,
      options: { defaultType: 'future' },
    });
    // Binance Demo Trading uses demo-fapi.binance.com, NOT the testnet
    // setSandboxMode(true) would point to testnet.binancefuture.com — wrong endpoint
    const demoUrls = this.exchangeDemo.urls as Record<string, Record<string, string>>;
    if (demoUrls?.api) {
      for (const key of Object.keys(demoUrls.api)) {
        if (typeof demoUrls.api[key] === 'string') {
          demoUrls.api[key] = demoUrls.api[key].replace(
            'fapi.binance.com',
            'demo-fapi.binance.com',
          );
        }
      }
    }

    this.exchangePublic = new ccxt.binanceusdm({
      options: { defaultType: 'future' },
    });

    try {
      await this.exchangePublic.loadMarkets();
      this.logger.log('[Public] โหลด markets สำเร็จ');
    } catch (err) {
      this.logger.error('[Public] loadMarkets ไม่ได้: ' + err.message);
    }

    try {
      await this.exchangeLive.loadMarkets();
      this.logger.log('[Live] เชื่อมต่อ Binance Futures สำเร็จ');
    } catch (err) {
      this.logger.error('[Live] เชื่อมต่อ Binance ไม่ได้: ' + err.message);
    }

    if (demoKey) {
      try {
        await this.exchangeDemo.fetchBalance();
        this.logger.log('[Demo] เชื่อมต่อ demo-fapi.binance.com สำเร็จ');
      } catch (err) {
        this.logger.warn('[Demo] เชื่อมต่อ demo-fapi.binance.com ไม่ได้: ' + err.message);
      }
    } else {
      this.logger.warn('[Demo] BINANCE_DEMO_API_KEY ไม่ได้ตั้งค่า — sandbox mode ไม่สามารถส่ง order ได้');
    }
  }

  async fetchOHLCV(limit = 200, symbol = 'BTC/USDT:USDT'): Promise<OHLCV[]> {
    try {
      const raw = await this.exchangePublic.fetchOHLCV(symbol, '1h', undefined, limit);
      return raw.map(([timestamp, open, high, low, close, volume]) => ({
        timestamp: timestamp as number,
        open:   open   as number,
        high:   high   as number,
        low:    low    as number,
        close:  close  as number,
        volume: volume as number,
      }));
    } catch (err) {
      this.logger.error(`fetchOHLCV(${symbol}) error: ` + err.message);
      return [];
    }
  }

  async fetchOHLCVByTimeframe(limit = 200, timeframe = '1h', symbol = 'BTC/USDT:USDT'): Promise<OHLCV[]> {
    try {
      const raw = await this.exchangePublic.fetchOHLCV(symbol, timeframe, undefined, limit);
      return raw.map(([timestamp, open, high, low, close, volume]) => ({
        timestamp: timestamp as number,
        open:   open   as number,
        high:   high   as number,
        low:    low    as number,
        close:  close  as number,
        volume: volume as number,
      }));
    } catch (err) {
      this.logger.error(`fetchOHLCVByTimeframe(${timeframe}, ${symbol}) error: ` + err.message);
      return [];
    }
  }

  async fetchTicker(symbol = 'BTC/USDT:USDT'): Promise<{ bid: number; ask: number; last: number }> {
    const ticker = await this.exchangePublic.fetchTicker(symbol);
    return { bid: ticker.bid, ask: ticker.ask, last: ticker.last };
  }

  async fetchBalance(mode: 'live' | 'sandbox' = 'live'): Promise<{ total: number; free: number; used: number }> {
    const exchange = this.getExchange(mode);
    // Use raw /fapi/v3/balance — ccxt fetchBalance() maps fields incorrectly for USDM futures
    // Response is array: [{asset, balance, availableBalance, ...}]
    const raw = await (exchange as any).fapiPrivateV3GetBalance({});
    const usdt = Array.isArray(raw) ? raw.find((b: any) => b.asset === 'USDT') : undefined;
    const total = parseFloat(usdt?.balance          ?? '0');
    const free  = parseFloat(usdt?.availableBalance ?? '0');
    return { total, free, used: total - free };
  }

  getExchange(mode: 'live' | 'sandbox' = 'live'): ccxt.binanceusdm {
    return mode === 'sandbox' ? this.exchangeDemo : this.exchangeLive;
  }
}
