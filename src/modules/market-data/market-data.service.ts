import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as ccxt from 'ccxt';
import { OHLCV } from '../../common/types';

@Injectable()
export class MarketDataService implements OnModuleInit {
  private readonly logger = new Logger(MarketDataService.name);
  private exchange: ccxt.binanceusdm;
  private symbol: string;
  private timeframe: string;

  constructor(private configService: ConfigService) {
    this.symbol    = this.configService.get<string>('trading.symbol', 'BTC/USDT:USDT');
    this.timeframe = this.configService.get<string>('trading.timeframe', '1h');
  }

  async onModuleInit() {
    const apiKey    = this.configService.get<string>('binance.apiKey');
    const apiSecret = this.configService.get<string>('binance.apiSecret');
    const testnet   = this.configService.get<boolean>('binance.testnet', true);

    this.exchange = new ccxt.binanceusdm({
      apiKey,
      secret: apiSecret,
      options: { defaultType: 'future' },
    });

    if (testnet) {
      this.exchange.setSandboxMode(true);
      this.logger.warn('กำลังใช้งาน Binance Testnet');
    }

    try {
      await this.exchange.loadMarkets();
      this.logger.log(`เชื่อมต่อ Binance Futures สำเร็จ | Symbol: ${this.symbol} | TF: ${this.timeframe}`);
    } catch (err) {
      this.logger.error('เชื่อมต่อ Binance ไม่ได้: ' + err.message);
    }
  }

  /**
   * ดึง OHLCV data จาก Binance Futures
   * @param limit จำนวน candle (default 200)
   */
  async fetchOHLCV(limit = 200): Promise<OHLCV[]> {
    try {
      const raw = await this.exchange.fetchOHLCV(this.symbol, this.timeframe, undefined, limit);
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
   * ดึง ticker ราคาปัจจุบัน
   */
  async fetchTicker(): Promise<{ bid: number; ask: number; last: number }> {
    const ticker = await this.exchange.fetchTicker(this.symbol);
    return { bid: ticker.bid, ask: ticker.ask, last: ticker.last };
  }

  getExchange(): ccxt.binanceusdm {
    return this.exchange;
  }

  getSymbol(): string { return this.symbol; }
  getTimeframe(): string { return this.timeframe; }
}
