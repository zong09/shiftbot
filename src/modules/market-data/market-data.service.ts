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
  private readonly symbol    = 'BTC/USDT:USDT';
  private readonly timeframe = '1h';

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
      this.logger.log(`[Public] โหลด markets สำเร็จ | Symbol: ${this.symbol}`);
    } catch (err) {
      this.logger.error('[Public] loadMarkets ไม่ได้: ' + err.message);
    }

    try {
      await this.exchangeLive.loadMarkets();
      this.logger.log(`[Live] เชื่อมต่อ Binance Futures สำเร็จ | Symbol: ${this.symbol}`);
    } catch (err) {
      this.logger.error('[Live] เชื่อมต่อ Binance ไม่ได้: ' + err.message);
    }

    if (demoKey) {
      try {
        await this.exchangeDemo.loadMarkets();
        this.logger.log(`[Demo] เชื่อมต่อ Binance Testnet สำเร็จ | Symbol: ${this.symbol}`);
      } catch (err) {
        this.logger.warn('[Demo] เชื่อมต่อ Binance Testnet ไม่ได้: ' + err.message);
      }
    } else {
      this.logger.warn('[Demo] BINANCE_DEMO_API_KEY ไม่ได้ตั้งค่า — sandbox mode ไม่สามารถส่ง order ได้');
    }
  }

  /**
   * ดึง OHLCV data จาก Binance Futures
   * @param limit จำนวน candle (default 200)
   */
  async fetchOHLCV(limit = 200): Promise<OHLCV[]> {
    try {
      const raw = await this.exchangePublic.fetchOHLCV(this.symbol, this.timeframe, undefined, limit);
      return raw.map(([timestamp, open, high, low, close, volume]) => ({
        timestamp: timestamp as number,
        open:   open   as number,
        high:   high   as number,
        low:    low    as number,
        close:  close  as number,
        volume: volume as number,
      }));
    } catch (err) {
      this.logger.error('fetchOHLCV error: ' + err.message);
      return [];
    }
  }

  /**
   * ดึง OHLCV data ด้วย timeframe ที่กำหนด (override bot default)
   */
  async fetchOHLCVByTimeframe(limit = 200, timeframe?: string): Promise<OHLCV[]> {
    const tf = timeframe ?? this.timeframe;
    try {
      const raw = await this.exchangePublic.fetchOHLCV(this.symbol, tf, undefined, limit);
      return raw.map(([timestamp, open, high, low, close, volume]) => ({
        timestamp: timestamp as number,
        open:   open   as number,
        high:   high   as number,
        low:    low    as number,
        close:  close  as number,
        volume: volume as number,
      }));
    } catch (err) {
      this.logger.error(`fetchOHLCVByTimeframe(${tf}) error: ` + err.message);
      return [];
    }
  }

  /**
   * ดึง ticker ราคาปัจจุบัน
   */
  async fetchTicker(): Promise<{ bid: number; ask: number; last: number }> {
    const ticker = await this.exchangePublic.fetchTicker(this.symbol);
    return { bid: ticker.bid, ask: ticker.ask, last: ticker.last };
  }

  getExchange(mode: 'live' | 'sandbox' = 'live'): ccxt.binanceusdm {
    return mode === 'sandbox' ? this.exchangeDemo : this.exchangeLive;
  }

  getSymbol(): string { return this.symbol; }
  getTimeframe(): string { return this.timeframe; }
}
