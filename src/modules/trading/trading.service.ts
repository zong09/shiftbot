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

  async hasOpenPosition(mode: TradingMode, symbol: string): Promise<boolean> {
    const count = await this.positionRepo.count({ where: { status: 'open', mode, symbol } });
    return count > 0;
  }

  async getOpenPositions(mode: TradingMode, symbol?: string): Promise<Position[]> {
    const where = symbol
      ? { status: 'open', mode, symbol }
      : { status: 'open', mode };
    const rows = await this.positionRepo.find({ where });
    return rows as unknown as Position[];
  }

  async getTradeHistory(mode: TradingMode, symbol?: string): Promise<TradeLog[]> {
    const where = symbol ? { mode, symbol } : { mode };
    const rows = await this.tradeLogRepo.find({
      where,
      order: { timestamp: 'DESC' },
    });
    return rows as unknown as TradeLog[];
  }

  async getTotalPnl(mode: TradingMode, symbol?: string): Promise<number> {
    const qb = this.tradeLogRepo
      .createQueryBuilder('t')
      .select('COALESCE(SUM(t.pnl), 0)', 'total')
      .where('t.mode = :mode', { mode });
    if (symbol) qb.andWhere('t.symbol = :symbol', { symbol });
    const result = await qb.getRawOne<{ total: string }>();
    return parseFloat(result.total);
  }

  // ──────────────────────────────────────────────
  //  OPEN LONG
  // ──────────────────────────────────────────────
  async openLong(currentPrice: number, zone: CDCZone, mode: TradingMode, symbol: string): Promise<Position | null> {
    const s = await this.settingsService.getSettings(mode, symbol);

    const openCount = await this.positionRepo.count({ where: { status: 'open', mode, symbol } });
    if (openCount >= s.maxPositions) {
      this.logger.warn(`[${mode}][${symbol}] ถึงจำนวน max position แล้ว ไม่เปิด position ใหม่`);
      return null;
    }

    try {
      const quantity = parseFloat(
        ((s.orderSizeUsdt * s.leverage) / currentPrice).toFixed(3),
      );

      let entryPrice = currentPrice;
      let orderId: string | undefined;

      const exchange = this.marketDataService.getExchange(mode);
      await exchange.setLeverage(s.leverage, symbol);
      const order = await exchange.createMarketBuyOrder(symbol, quantity, {
        reduceOnly: false,
      });
      entryPrice = order.average ?? currentPrice;
      orderId    = order.id;

      const stopLoss   = entryPrice * (1 - s.stopLossPct / 100);
      const takeProfit = entryPrice * (1 + s.takeProfitPct / 100);

      const saved = await this.positionRepo.save(
        this.positionRepo.create({
          symbol,
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
          symbol,
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
        `[${mode}][${symbol}] OPEN LONG | Price=${entryPrice} | Qty=${quantity} | SL=${stopLoss.toFixed(2)} | TP=${takeProfit.toFixed(2)}`,
      );

      return saved as unknown as Position;
    } catch (err) {
      this.logger.error(`[${mode}][${symbol}] openLong error: ` + err.message);
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
    const symbol = position.symbol;

    try {
      const exchange = this.marketDataService.getExchange(mode);
      await exchange.createMarketSellOrder(symbol, position.quantity, {
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
          symbol,
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
        `[${mode}][${symbol}] CLOSE LONG (${reason}) | Price=${currentPrice} | PnL=${pnl.toFixed(2)} USDT`,
      );
    } catch (err) {
      this.logger.error(`[${mode}][${symbol}] closeLong error: ` + err.message);
    }
  }

  // ──────────────────────────────────────────────
  //  CLOSE ALL OPEN POSITIONS for a specific symbol
  // ──────────────────────────────────────────────
  async closeAllPositions(mode: TradingMode, symbol: string): Promise<void> {
    const positions = await this.getOpenPositions(mode, symbol);
    if (!positions.length) return;

    const { last: currentPrice } = await this.marketDataService.fetchTicker(symbol);
    for (const pos of positions) {
      if (pos.side === 'long') {
        await this.closeLong(pos, currentPrice, CDCZone.STRONG_BEAR, 'SIGNAL', mode);
      }
    }
    this.logger.log(`[${mode}][${symbol}] closeAllPositions: closed ${positions.length} position(s) at ${currentPrice}`);
  }

  // ──────────────────────────────────────────────
  //  SYNC POSITIONS WITH BINANCE
  // ──────────────────────────────────────────────
  async syncPositions(mode: TradingMode, symbol?: string): Promise<void> {
    const localPositions = await this.getOpenPositions(mode, symbol);
    if (!localPositions.length) return;

    try {
      const exchange = this.marketDataService.getExchange(mode);
      const symbolsToFetch = symbol ? [symbol] : Array.from(new Set(localPositions.map(p => p.symbol)));
      
      const exchangePositions = await exchange.fetchPositions(symbolsToFetch);
      
      for (const localPos of localPositions) {
        // ccxt position side might be 'long' or 'short', or undefined if one-way and contracts is 0.
        // We match by symbol and side (if available in exchange response).
        const remotePos = exchangePositions.find(p => p.symbol === localPos.symbol && (!p.side || p.side === localPos.side));
        
        const isClosed = !remotePos || !remotePos.contracts || remotePos.contracts === 0;
        
        if (isClosed) {
          this.logger.warn(`[${mode}][${localPos.symbol}] Position ${localPos.side} is actually closed on Binance. Updating DB to sync...`);
          
          await this.positionRepo.update(localPos.id, {
            status: 'closed',
            closeTime: new Date(),
            // PnL and other details are difficult to fetch retroactively without fetchMyTrades, 
            // so we leave closedPnl as 0 or calculate from last known state if needed.
            closedPnl: 0,
          });
          
          // Log trade update for manual tracking
          await this.tradeLogRepo.save(
            this.tradeLogRepo.create({
              symbol: localPos.symbol,
              action: 'SYNC_CLOSE',
              price: 0, // Unknown
              quantity: localPos.quantity,
              pnl: 0,
              zone: CDCZone.NONE,
              signal: 'HOLD',
              mode,
            })
          );
        }
      }
    } catch (err) {
      this.logger.error(`[${mode}] syncPositions error: ` + err.message);
    }
  }

  // ──────────────────────────────────────────────
  //  CHECK STOP LOSS / TAKE PROFIT
  // ──────────────────────────────────────────────
  async checkSLTP(currentPrice: number, zone: CDCZone, mode: TradingMode, symbol: string): Promise<void> {
    const positions = await this.getOpenPositions(mode, symbol);
    for (const position of positions) {
      if (position.side === 'long') {
        if (currentPrice <= position.stopLoss) {
          this.logger.warn(`[${mode}][${symbol}] Stop Loss triggered! Price=${currentPrice} SL=${position.stopLoss}`);
          await this.closeLong(position, currentPrice, zone, 'SL', mode);
        } else if (currentPrice >= position.takeProfit) {
          this.logger.log(`[${mode}][${symbol}] Take Profit triggered! Price=${currentPrice} TP=${position.takeProfit}`);
          await this.closeLong(position, currentPrice, zone, 'TP', mode);
        }
      }
    }
  }
}
