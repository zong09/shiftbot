import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { v4 as uuid } from 'uuid';
import { MarketDataService } from '../market-data/market-data.service';
import { Position, TradeLog, CDCZone } from '../../common/types';

@Injectable()
export class TradingService {
  private readonly logger = new Logger(TradingService.name);

  private openPositions: Map<string, Position> = new Map();
  private tradeHistory: TradeLog[] = [];
  private totalPnl = 0;

  private leverage: number;
  private orderSizeUsdt: number;
  private stopLossPct: number;
  private takeProfitPct: number;
  private maxPositions: number;
  private symbol: string;

  constructor(
    private configService: ConfigService,
    private marketDataService: MarketDataService,
  ) {
    this.leverage       = this.configService.get<number>('trading.leverage', 5);
    this.orderSizeUsdt  = this.configService.get<number>('trading.orderSizeUsdt', 100);
    this.stopLossPct    = this.configService.get<number>('riskManagement.stopLossPct', 2.0);
    this.takeProfitPct  = this.configService.get<number>('riskManagement.takeProfitPct', 4.0);
    this.maxPositions   = this.configService.get<number>('trading.maxPositions', 1);
    this.symbol         = this.configService.get<string>('trading.symbol', 'BTC/USDT:USDT');
  }

  hasOpenPosition(): boolean {
    return this.openPositions.size > 0;
  }

  getOpenPositions(): Position[] {
    return Array.from(this.openPositions.values());
  }

  getTradeHistory(): TradeLog[] {
    return this.tradeHistory;
  }

  getTotalPnl(): number {
    return this.totalPnl;
  }

  // ──────────────────────────────────────────────
  //  OPEN LONG
  // ──────────────────────────────────────────────
  async openLong(currentPrice: number, zone: CDCZone): Promise<Position | null> {
    if (this.openPositions.size >= this.maxPositions) {
      this.logger.warn('ถึงจำนวน max position แล้ว ไม่เปิด position ใหม่');
      return null;
    }

    const exchange = this.marketDataService.getExchange();

    try {
      // ตั้ง leverage
      await exchange.setLeverage(this.leverage, this.symbol);

      const quantity = parseFloat(
        ((this.orderSizeUsdt * this.leverage) / currentPrice).toFixed(3),
      );

      const order = await exchange.createMarketBuyOrder(this.symbol, quantity, {
        reduceOnly: false,
      });

      const entryPrice = order.average ?? currentPrice;
      const stopLoss   = entryPrice * (1 - this.stopLossPct / 100);
      const takeProfit = entryPrice * (1 + this.takeProfitPct / 100);

      const position: Position = {
        id:         uuid(),
        symbol:     this.symbol,
        side:       'long',
        entryPrice,
        quantity,
        stopLoss,
        takeProfit,
        openTime:   new Date(),
        status:     'open',
      };

      this.openPositions.set(position.id, position);

      const log: TradeLog = {
        id:        uuid(),
        timestamp: new Date(),
        symbol:    this.symbol,
        action:    'OPEN_LONG',
        price:     entryPrice,
        quantity,
        zone,
        signal:    'BUY',
        orderId:   order.id,
      };
      this.tradeHistory.push(log);

      this.logger.log(
        `OPEN LONG | Price=${entryPrice} | Qty=${quantity} | SL=${stopLoss.toFixed(2)} | TP=${takeProfit.toFixed(2)}`,
      );

      return position;
    } catch (err) {
      this.logger.error('openLong error: ' + err.message);
      return null;
    }
  }

  // ──────────────────────────────────────────────
  //  CLOSE LONG
  // ──────────────────────────────────────────────
  async closeLong(
    position: Position,
    currentPrice: number,
    zone: CDCZone,
    reason: 'SIGNAL' | 'SL' | 'TP',
  ): Promise<void> {
    const exchange = this.marketDataService.getExchange();

    try {
      await exchange.createMarketSellOrder(this.symbol, position.quantity, {
        reduceOnly: true,
      });

      const pnl = (currentPrice - position.entryPrice) * position.quantity;
      position.closedPnl = pnl;
      position.closeTime = new Date();
      position.status    = 'closed';
      this.totalPnl     += pnl;

      this.openPositions.delete(position.id);

      const action = reason === 'SL' ? 'SL_HIT' : reason === 'TP' ? 'TP_HIT' : 'CLOSE_LONG';
      const log: TradeLog = {
        id:        uuid(),
        timestamp: new Date(),
        symbol:    this.symbol,
        action,
        price:     currentPrice,
        quantity:  position.quantity,
        pnl,
        zone,
        signal:    'SELL',
      };
      this.tradeHistory.push(log);

      this.logger.log(`CLOSE LONG (${reason}) | Price=${currentPrice} | PnL=${pnl.toFixed(2)} USDT`);
    } catch (err) {
      this.logger.error('closeLong error: ' + err.message);
    }
  }

  // ──────────────────────────────────────────────
  //  CHECK STOP LOSS / TAKE PROFIT
  // ──────────────────────────────────────────────
  async checkSLTP(currentPrice: number, zone: CDCZone): Promise<void> {
    for (const position of this.openPositions.values()) {
      if (position.side === 'long') {
        if (currentPrice <= position.stopLoss) {
          this.logger.warn(`Stop Loss triggered! Price=${currentPrice} SL=${position.stopLoss}`);
          await this.closeLong(position, currentPrice, zone, 'SL');
        } else if (currentPrice >= position.takeProfit) {
          this.logger.log(`Take Profit triggered! Price=${currentPrice} TP=${position.takeProfit}`);
          await this.closeLong(position, currentPrice, zone, 'TP');
        }
      }
    }
  }
}
