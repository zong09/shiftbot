import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { MarketDataService } from '../market-data/market-data.service';
import { TradingSettingsService } from '../trading-settings/trading-settings.service';
import { Position, TradeLog, CDCZone } from '../../common/types';
import { PositionEntity } from '../../database/entities/position.entity';
import { TradeLogEntity } from '../../database/entities/trade-log.entity';

export type TradingMode = 'live' | 'sandbox';

@Injectable()
export class TradingService {
  private readonly logger = new Logger(TradingService.name);

  constructor(
    @InjectRepository(PositionEntity)
    private positionRepo: Repository<PositionEntity>,
    @InjectRepository(TradeLogEntity)
    private tradeLogRepo: Repository<TradeLogEntity>,
    private marketDataService: MarketDataService,
    private settingsService: TradingSettingsService,
  ) {}

  async hasOpenPosition(mode: TradingMode): Promise<boolean> {
    const count = await this.positionRepo.count({ where: { status: 'open', mode } });
    return count > 0;
  }

  async getOpenPositions(mode: TradingMode): Promise<Position[]> {
    const rows = await this.positionRepo.find({ where: { status: 'open', mode } });
    return rows as unknown as Position[];
  }

  async getTradeHistory(mode: TradingMode): Promise<TradeLog[]> {
    const rows = await this.tradeLogRepo.find({
      where: { mode },
      order: { timestamp: 'DESC' },
    });
    return rows as unknown as TradeLog[];
  }

  async getTotalPnl(mode: TradingMode): Promise<number> {
    const result = await this.tradeLogRepo
      .createQueryBuilder('t')
      .select('COALESCE(SUM(t.pnl), 0)', 'total')
      .where('t.mode = :mode', { mode })
      .getRawOne<{ total: string }>();
    return parseFloat(result.total);
  }

  // ──────────────────────────────────────────────
  //  OPEN LONG
  // ──────────────────────────────────────────────
  async openLong(currentPrice: number, zone: CDCZone, mode: TradingMode): Promise<Position | null> {
    const s = await this.settingsService.getSettings(mode);

    const openCount = await this.positionRepo.count({ where: { status: 'open', mode } });
    if (openCount >= s.maxPositions) {
      this.logger.warn(`[${mode}] ถึงจำนวน max position แล้ว ไม่เปิด position ใหม่`);
      return null;
    }

    try {
      const quantity = parseFloat(
        ((s.orderSizeUsdt * s.leverage) / currentPrice).toFixed(3),
      );

      let entryPrice = currentPrice;
      let orderId: string | undefined;

      const exchange = this.marketDataService.getExchange(mode);
      await exchange.setLeverage(s.leverage, s.symbol);
      const order = await exchange.createMarketBuyOrder(s.symbol, quantity, {
        reduceOnly: false,
      });
      entryPrice = order.average ?? currentPrice;
      orderId    = order.id;

      const stopLoss   = entryPrice * (1 - s.stopLossPct / 100);
      const takeProfit = entryPrice * (1 + s.takeProfitPct / 100);

      const saved = await this.positionRepo.save(
        this.positionRepo.create({
          symbol: s.symbol,
          side:   'long',
          entryPrice,
          quantity,
          stopLoss,
          takeProfit,
          status: 'open',
          mode,
        }),
      );

      await this.tradeLogRepo.save(
        this.tradeLogRepo.create({
          symbol:  s.symbol,
          action:  'OPEN_LONG',
          price:   entryPrice,
          quantity,
          zone,
          signal:  'BUY',
          orderId,
          mode,
        }),
      );

      this.logger.log(
        `[${mode}] OPEN LONG | Price=${entryPrice} | Qty=${quantity} | SL=${stopLoss.toFixed(2)} | TP=${takeProfit.toFixed(2)}`,
      );

      return saved as unknown as Position;
    } catch (err) {
      this.logger.error(`[${mode}] openLong error: ` + err.message);
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
    mode: TradingMode,
  ): Promise<void> {
    const s = await this.settingsService.getSettings(mode);

    try {
      const exchange = this.marketDataService.getExchange(mode);
      await exchange.createMarketSellOrder(s.symbol, position.quantity, {
        reduceOnly: true,
      });

      const pnl       = (currentPrice - position.entryPrice) * position.quantity;
      const closeTime = new Date();

      await this.positionRepo.update(position.id, {
        closedPnl: pnl,
        closeTime,
        status: 'closed',
      });

      const action = reason === 'SL' ? 'SL_HIT' : reason === 'TP' ? 'TP_HIT' : 'CLOSE_LONG';
      await this.tradeLogRepo.save(
        this.tradeLogRepo.create({
          symbol:   s.symbol,
          action,
          price:    currentPrice,
          quantity: position.quantity,
          pnl,
          zone,
          signal:   'SELL',
          mode,
        }),
      );

      this.logger.log(
        `[${mode}] CLOSE LONG (${reason}) | Price=${currentPrice} | PnL=${pnl.toFixed(2)} USDT`,
      );
    } catch (err) {
      this.logger.error(`[${mode}] closeLong error: ` + err.message);
    }
  }

  // ──────────────────────────────────────────────
  //  CLOSE ALL OPEN POSITIONS (manual / status=off)
  // ──────────────────────────────────────────────
  async closeAllPositions(mode: TradingMode): Promise<void> {
    const positions = await this.getOpenPositions(mode);
    if (!positions.length) return;

    const { last: currentPrice } = await this.marketDataService.fetchTicker();
    for (const pos of positions) {
      if (pos.side === 'long') {
        await this.closeLong(pos, currentPrice, CDCZone.STRONG_BEAR, 'SIGNAL', mode);
      }
    }
    this.logger.log(`[${mode}] closeAllPositions: closed ${positions.length} position(s) at ${currentPrice}`);
  }

  // ──────────────────────────────────────────────
  //  CHECK STOP LOSS / TAKE PROFIT
  // ──────────────────────────────────────────────
  async checkSLTP(currentPrice: number, zone: CDCZone, mode: TradingMode): Promise<void> {
    const positions = await this.getOpenPositions(mode);
    for (const position of positions) {
      if (position.side === 'long') {
        if (currentPrice <= position.stopLoss) {
          this.logger.warn(`[${mode}] Stop Loss triggered! Price=${currentPrice} SL=${position.stopLoss}`);
          await this.closeLong(position, currentPrice, zone, 'SL', mode);
        } else if (currentPrice >= position.takeProfit) {
          this.logger.log(`[${mode}] Take Profit triggered! Price=${currentPrice} TP=${position.takeProfit}`);
          await this.closeLong(position, currentPrice, zone, 'TP', mode);
        }
      }
    }
  }
}
