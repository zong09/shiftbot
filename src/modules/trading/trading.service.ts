import { Injectable, Logger, NotFoundException, BadRequestException, BadGatewayException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { MarketDataService } from '../market-data/market-data.service';
import { TradingSettingsService } from '../trading-settings/trading-settings.service';
import { Position, TradeLog, CDCZone } from '../../common/types';
import { PositionEntity } from '../../database/entities/position.entity';
import { TradeLogEntity } from '../../database/entities/trade-log.entity';

export type TradingMode = 'live' | 'sandbox';
type Exchange = ReturnType<MarketDataService['getExchange']>;

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
    return parseFloat(result?.total ?? '0');
  }

  // ──────────────────────────────────────────────
  //  EXCHANGE ORDER HELPERS
  // ──────────────────────────────────────────────

  /** Round to the exchange lot size; throws when the result would be a zero-quantity order. */
  private async toOrderAmount(exchange: Exchange, symbol: string, rawQty: number): Promise<number> {
    if (!exchange.markets || !Object.keys(exchange.markets).length) {
      await exchange.loadMarkets();
    }
    const qty = parseFloat(exchange.amountToPrecision(symbol, rawQty));
    if (!qty || qty <= 0) {
      throw new Error(
        `quantity ${rawQty} rounds to 0 under ${symbol} lot size — increase orderSizeUsdt`,
      );
    }
    return qty;
  }

  /**
   * ตรวจตอนบันทึก settings ว่า orderSizeUsdt × leverage ยังผ่าน minNotional ของ
   * exchange หลังปัดเศษ lot size แล้ว (กัน error -4164 ตอนเปิดไม้จริง)
   * โยน BadRequestException พร้อมค่าต่ำสุดที่แนะนำเมื่อไม่ผ่าน
   * ถ้าโหลด market/ราคาไม่ได้ (infrastructure) จะข้ามการตรวจ ไม่ block การบันทึก
   */
  async validateOrderSize(
    mode: TradingMode,
    symbol: string,
    orderSizeUsdt: number,
    leverage: number,
  ): Promise<void> {
    const exchange = this.marketDataService.getExchange(mode);
    let market: any;
    let last: number;
    try {
      if (!exchange.markets || !Object.keys(exchange.markets).length) {
        await exchange.loadMarkets();
      }
      market = exchange.markets[symbol];
      ({ last } = await this.marketDataService.fetchTicker(symbol));
    } catch (err) {
      this.logger.warn(`[${mode}][${symbol}] validateOrderSize ข้ามการตรวจ: ${err.message}`);
      return;
    }
    if (!market || !last) return;

    const minCost = market.limits?.cost?.min ?? 0;
    let qty = 0;
    try {
      qty = parseFloat(exchange.amountToPrecision(symbol, (orderSizeUsdt * leverage) / last));
    } catch {
      qty = 0;
    }
    const notional = qty * last;
    if (qty > 0 && notional >= minCost) return;

    // lot step: ccxt binance เก็บ precision.amount เป็น step size (เช่น 0.001)
    // แต่กันเคสเป็นจำนวนตำแหน่งทศนิยมไว้ด้วย
    const precision = market.precision?.amount;
    const step = typeof precision === 'number' && precision > 0
      ? (precision < 1 ? precision : Math.pow(10, -precision))
      : 0;
    const minQtyByCost = step > 0 ? Math.ceil(minCost / last / step) * step : minCost / last;
    const minQty = Math.max(market.limits?.amount?.min ?? 0, minQtyByCost);
    // +5% buffer กันราคาขยับหลังบันทึก
    const suggested = Math.ceil(((minQty * last) / leverage) * 1.05 * 100) / 100;
    throw new BadRequestException(
      `orderSizeUsdt ${orderSizeUsdt} × leverage ${leverage}x = notional ~${notional.toFixed(2)} USDT ` +
      `ต่ำกว่าขั้นต่ำ ${minCost} USDT ของ ${symbol} (หลังปัดเศษ lot size) — ` +
      `ตั้ง orderSizeUsdt อย่างน้อย ~${suggested} USDT`,
    );
  }

  /**
   * Place reduceOnly STOP_MARKET + TAKE_PROFIT_MARKET orders on the exchange so
   * SL/TP trigger even while the bot is down. Failures are logged but do not
   * roll back the entry — the position simply has no exchange-side protection.
   */
  private async placeProtectiveOrders(
    exchange: Exchange,
    symbol: string,
    side: 'long' | 'short',
    quantity: number,
    stopLoss: number,
    takeProfit: number,
    mode: TradingMode,
  ): Promise<{ slOrderId: string | null; tpOrderId: string | null }> {
    const closeSide = side === 'long' ? 'sell' : 'buy';
    let slOrderId: string | null = null;
    let tpOrderId: string | null = null;

    try {
      const sl = await exchange.createOrder(symbol, 'market', closeSide, quantity, undefined, {
        stopLossPrice: exchange.priceToPrecision(symbol, stopLoss),
        reduceOnly: true,
      });
      slOrderId = sl.id ?? null;
    } catch (err) {
      this.logger.error(
        `[${mode}][${symbol}] วาง STOP_MARKET ไม่สำเร็จ: ${err.message} — position นี้ไม่มี SL บน exchange`,
      );
    }

    try {
      const tp = await exchange.createOrder(symbol, 'market', closeSide, quantity, undefined, {
        takeProfitPrice: exchange.priceToPrecision(symbol, takeProfit),
        reduceOnly: true,
      });
      tpOrderId = tp.id ?? null;
    } catch (err) {
      this.logger.error(
        `[${mode}][${symbol}] วาง TAKE_PROFIT_MARKET ไม่สำเร็จ: ${err.message} — position นี้ไม่มี TP บน exchange`,
      );
    }

    return { slOrderId, tpOrderId };
  }

  /** Cancel the SL/TP sibling orders of a position; already-filled/cancelled orders are ignored. */
  private async cancelProtectiveOrders(
    exchange: Exchange,
    position: Pick<Position, 'symbol' | 'slOrderId' | 'tpOrderId'>,
    mode: TradingMode,
  ): Promise<void> {
    for (const orderId of [position.slOrderId, position.tpOrderId]) {
      if (!orderId) continue;
      try {
        await exchange.cancelOrder(orderId, position.symbol);
      } catch (err) {
        this.logger.debug(
          `[${mode}][${position.symbol}] cancel protective order ${orderId}: ${err.message}`,
        );
      }
    }
  }

  /**
   * Realized PnL for a symbol since a timestamp via the Binance income endpoint.
   * With maxPositions > 1 on the same symbol this aggregates across those positions.
   * Returns null when the endpoint fails or has no records (caller falls back to mark price).
   */
  private async fetchRealizedPnl(
    exchange: Exchange,
    symbol: string,
    sinceMs: number,
  ): Promise<number | null> {
    try {
      if (!exchange.markets || !Object.keys(exchange.markets).length) {
        await exchange.loadMarkets();
      }
      const raw = await (exchange as any).fapiPrivateGetIncome({
        symbol: exchange.marketId(symbol),
        incomeType: 'REALIZED_PNL',
        startTime: sinceMs,
        limit: 1000,
      });
      if (!Array.isArray(raw) || raw.length === 0) return null;
      return raw.reduce((sum: number, r: any) => sum + parseFloat(r.income ?? '0'), 0);
    } catch (err) {
      this.logger.warn(`[${symbol}] fetchRealizedPnl ไม่สำเร็จ: ${err.message}`);
      return null;
    }
  }

  // ──────────────────────────────────────────────
  //  OPEN LONG
  // ──────────────────────────────────────────────
  async openLong(currentPrice: number, zone: CDCZone, mode: TradingMode, symbol: string): Promise<Position | null> {
    const s = await this.settingsService.getSettings(mode, symbol);

    const openCount = await this.positionRepo.count({ where: { status: 'open', mode, symbol, side: 'long' } });
    if (openCount >= s.maxPositions) {
      this.logger.warn(`[${mode}][${symbol}] ถึงจำนวน max position แล้ว ไม่เปิด position ใหม่`);
      return null;
    }

    try {
      const exchange = this.marketDataService.getExchange(mode);
      const quantity = await this.toOrderAmount(
        exchange, symbol, (s.orderSizeUsdt * s.leverage) / currentPrice,
      );

      let entryPrice = currentPrice;
      let orderId: string | undefined;

      await exchange.setLeverage(s.leverage, symbol);
      const order = await exchange.createMarketBuyOrder(symbol, quantity, {
        reduceOnly: false,
      });
      entryPrice = order.average ?? currentPrice;
      orderId    = order.id;

      const stopLoss   = entryPrice * (1 - s.stopLossPct / 100);
      const takeProfit = entryPrice * (1 + s.takeProfitPct / 100);

      const { slOrderId, tpOrderId } = await this.placeProtectiveOrders(
        exchange, symbol, 'long', quantity, stopLoss, takeProfit, mode,
      );

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
          slOrderId,
          tpOrderId,
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
      // rethrow เพื่อให้ StrategyService ไม่อัปเดต lastZone — สัญญาณจะ retry แท่งถัดไป
      this.logger.error(`[${mode}][${symbol}] openLong error: ` + err.message);
      throw err;
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
      await this.cancelProtectiveOrders(exchange, position, mode);
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
  //  OPEN SHORT
  // ──────────────────────────────────────────────
  async openShort(currentPrice: number, zone: CDCZone, mode: TradingMode, symbol: string): Promise<Position | null> {
    const s = await this.settingsService.getSettings(mode, symbol);

    const openCount = await this.positionRepo.count({ where: { status: 'open', mode, symbol, side: 'short' } });
    if (openCount >= s.maxPositions) {
      this.logger.warn(`[${mode}][${symbol}] ถึงจำนวน max position แล้ว ไม่เปิด short ใหม่`);
      return null;
    }

    try {
      const exchange = this.marketDataService.getExchange(mode);
      const quantity = await this.toOrderAmount(
        exchange, symbol, (s.orderSizeUsdt * s.leverage) / currentPrice,
      );

      let entryPrice = currentPrice;
      let orderId: string | undefined;

      await exchange.setLeverage(s.leverage, symbol);
      const order = await exchange.createMarketSellOrder(symbol, quantity, {
        reduceOnly: false,
      });
      entryPrice = order.average ?? currentPrice;
      orderId    = order.id;

      const stopLoss   = entryPrice * (1 + s.stopLossPct / 100);
      const takeProfit = entryPrice * (1 - s.takeProfitPct / 100);

      const { slOrderId, tpOrderId } = await this.placeProtectiveOrders(
        exchange, symbol, 'short', quantity, stopLoss, takeProfit, mode,
      );

      const saved = await this.positionRepo.save(
        this.positionRepo.create({
          symbol,
          side:   'short',
          entryPrice,
          quantity,
          stopLoss,
          takeProfit,
          status: 'open',
          mode,
          slOrderId,
          tpOrderId,
        }),
      );

      await this.tradeLogRepo.save(
        this.tradeLogRepo.create({
          symbol,
          action:  'OPEN_SHORT',
          price:   entryPrice,
          quantity,
          zone,
          signal:  'SELL',
          orderId,
          mode,
        }),
      );

      this.logger.log(
        `[${mode}][${symbol}] OPEN SHORT | Price=${entryPrice} | Qty=${quantity} | SL=${stopLoss.toFixed(2)} | TP=${takeProfit.toFixed(2)}`,
      );

      return saved as unknown as Position;
    } catch (err) {
      // rethrow เพื่อให้ StrategyService ไม่อัปเดต lastZone — สัญญาณจะ retry แท่งถัดไป
      this.logger.error(`[${mode}][${symbol}] openShort error: ` + err.message);
      throw err;
    }
  }

  // ──────────────────────────────────────────────
  //  CLOSE SHORT
  // ──────────────────────────────────────────────
  async closeShort(
    position: Position,
    currentPrice: number,
    zone: CDCZone,
    reason: 'SIGNAL' | 'SL' | 'TP',
    mode: TradingMode,
  ): Promise<void> {
    const symbol = position.symbol;

    try {
      const exchange = this.marketDataService.getExchange(mode);
      await this.cancelProtectiveOrders(exchange, position, mode);
      await exchange.createMarketBuyOrder(symbol, position.quantity, {
        reduceOnly: true,
      });

      const pnl       = (position.entryPrice - currentPrice) * position.quantity;
      const closeTime = new Date();

      await this.positionRepo.update(position.id, {
        closedPnl: pnl,
        closeTime,
        status: 'closed',
      });

      const action = reason === 'SL' ? 'SL_HIT' : reason === 'TP' ? 'TP_HIT' : 'CLOSE_SHORT';
      await this.tradeLogRepo.save(
        this.tradeLogRepo.create({
          symbol,
          action,
          price:    currentPrice,
          quantity: position.quantity,
          pnl,
          zone,
          signal:   'BUY',
          mode,
        }),
      );

      this.logger.log(
        `[${mode}][${symbol}] CLOSE SHORT (${reason}) | Price=${currentPrice} | PnL=${pnl.toFixed(2)} USDT`,
      );
    } catch (err) {
      this.logger.error(`[${mode}][${symbol}] closeShort error: ` + err.message);
    }
  }

  // ──────────────────────────────────────────────
  //  CLOSE ALL OPEN POSITIONS for a specific symbol
  // ──────────────────────────────────────────────
  async closeAllPositions(mode: TradingMode, symbol: string): Promise<void> {
    const positions = await this.getOpenPositions(mode, symbol);
    if (!positions.length) return;

    // Closing must proceed even if the ticker is unavailable — fall back to
    // entryPrice (records PnL 0) rather than persisting NaN or aborting.
    let currentPrice: number;
    try {
      const { last } = await this.marketDataService.fetchTicker(symbol);
      currentPrice = Number.isFinite(last) ? last : positions[0].entryPrice;
    } catch (err) {
      this.logger.warn(`[${mode}][${symbol}] fetchTicker ไม่สำเร็จ (${err.message}) — ใช้ entryPrice แทนในการบันทึก PnL`);
      currentPrice = positions[0].entryPrice;
    }
    for (const pos of positions) {
      if (pos.side === 'long') {
        await this.closeLong(pos, currentPrice, CDCZone.NONE, 'SIGNAL', mode);
      } else if (pos.side === 'short') {
        await this.closeShort(pos, currentPrice, CDCZone.NONE, 'SIGNAL', mode);
      }
    }
    this.logger.log(`[${mode}][${symbol}] closeAllPositions: closed ${positions.length} position(s) at ${currentPrice}`);
  }

  // ──────────────────────────────────────────────
  //  CLOSE A SINGLE POSITION BY ID (manual close)
  // ──────────────────────────────────────────────
  async closePositionById(id: string): Promise<Position> {
    const position = await this.positionRepo.findOne({ where: { id } });
    if (!position) throw new NotFoundException(`ไม่พบ position ${id}`);
    if (position.status !== 'open') throw new BadRequestException(`position ${id} ถูกปิดไปแล้ว`);

    const mode = position.mode as TradingMode;
    const { last: currentPrice } = await this.marketDataService.fetchTicker(position.symbol);
    if (!Number.isFinite(currentPrice)) {
      throw new BadGatewayException('ดึงราคาล่าสุดจาก exchange ไม่ได้ กรุณาลองใหม่');
    }

    if (position.side === 'long') {
      await this.closeLong(position as unknown as Position, currentPrice, CDCZone.NONE, 'SIGNAL', mode);
    } else {
      await this.closeShort(position as unknown as Position, currentPrice, CDCZone.NONE, 'SIGNAL', mode);
    }

    const updated = await this.positionRepo.findOne({ where: { id } });
    if (!updated || updated.status !== 'closed') {
      throw new BadGatewayException('ปิด position ไม่สำเร็จ กรุณาลองใหม่หรือตรวจสอบที่ exchange');
    }
    return updated as unknown as Position;
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

          // The close happened on-exchange (SL/TP filled or manual) — cancel the surviving sibling order
          await this.cancelProtectiveOrders(exchange, localPos, mode);

          // Prefer actual realized PnL from the income endpoint; fall back to a
          // mark-price estimate so the ledger never records a hard-coded 0.
          const openTimeMs = new Date(localPos.openTime).getTime();
          const realized = await this.fetchRealizedPnl(exchange, localPos.symbol, openTimeMs);

          let pnl: number;
          let price = 0;
          if (realized !== null) {
            pnl = realized;
          } else {
            try {
              const { last } = await this.marketDataService.fetchTicker(localPos.symbol);
              price = Number.isFinite(last) ? last : localPos.entryPrice;
            } catch {
              price = localPos.entryPrice;
            }
            pnl = localPos.side === 'long'
              ? (price - localPos.entryPrice) * localPos.quantity
              : (localPos.entryPrice - price) * localPos.quantity;
            this.logger.warn(`[${mode}][${localPos.symbol}] ใช้ mark-price ประมาณ PnL (${pnl.toFixed(2)}) — income endpoint ไม่มีข้อมูล`);
          }

          await this.positionRepo.update(localPos.id, {
            status: 'closed',
            closeTime: new Date(),
            closedPnl: pnl,
          });

          await this.tradeLogRepo.save(
            this.tradeLogRepo.create({
              symbol: localPos.symbol,
              action: 'SYNC_CLOSE',
              price,
              quantity: localPos.quantity,
              pnl,
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
      } else if (position.side === 'short') {
        if (currentPrice >= position.stopLoss) {
          this.logger.warn(`[${mode}][${symbol}] Stop Loss triggered (Short)! Price=${currentPrice} SL=${position.stopLoss}`);
          await this.closeShort(position, currentPrice, zone, 'SL', mode);
        } else if (currentPrice <= position.takeProfit) {
          this.logger.log(`[${mode}][${symbol}] Take Profit triggered (Short)! Price=${currentPrice} TP=${position.takeProfit}`);
          await this.closeShort(position, currentPrice, zone, 'TP', mode);
        }
      }
    }
  }
}
