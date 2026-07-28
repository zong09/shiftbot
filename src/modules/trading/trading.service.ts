import { Injectable, Logger, NotFoundException, BadRequestException, BadGatewayException, OnApplicationBootstrap } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { MarketDataService } from '../market-data/market-data.service';
import { TradingSettingsService } from '../trading-settings/trading-settings.service';
import { NotificationService } from '../notification/notification.service';
import { Position, TradeLog, CDCZone } from '../../common/types';
import { PositionEntity } from '../../database/entities/position.entity';
import { TradeLogEntity } from '../../database/entities/trade-log.entity';

export type TradingMode = 'live' | 'sandbox';
type Exchange = ReturnType<MarketDataService['getExchange']>;

@Injectable()
export class TradingService implements OnApplicationBootstrap {
  private readonly logger = new Logger(TradingService.name);

  /**
   * A close claims its position by flipping 'open' → 'closing' before touching the
   * exchange. If the process dies mid-close, the row is stranded in 'closing':
   * syncPositions only reconciles 'open' rows, so it would never be finalized.
   * At boot there are no in-flight closes, so any 'closing' row is stale — revert it
   * to 'open' and let the next syncPositions reconcile it against the exchange.
   */
  async onApplicationBootstrap(): Promise<void> {
    const reverted = await this.positionRepo.update(
      { status: 'closing' },
      { status: 'open' },
    );
    if (reverted.affected) {
      this.logger.warn(`[boot] คืนสถานะ ${reverted.affected} position ที่ค้าง 'closing' → 'open' เพื่อ reconcile`);
    }
  }

  constructor(
    @InjectRepository(PositionEntity)
    private positionRepo: Repository<PositionEntity>,
    @InjectRepository(TradeLogEntity)
    private tradeLogRepo: Repository<TradeLogEntity>,
    private marketDataService: MarketDataService,
    private settingsService: TradingSettingsService,
    private notificationService: NotificationService,
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

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /** Log/notify format for an SL/TP price, where 0 means the leg is switched off. */
  private static fmtProtective(price: number): string {
    return price > 0 ? price.toFixed(2) : 'OFF';
  }

  private static readonly PROTECTIVE_RETRY_MS = 2000;

  /**
   * Place reduceOnly STOP_MARKET + TAKE_PROFIT_MARKET orders on the exchange so
   * SL/TP trigger even while the bot is down. Failures are logged but do not
   * roll back the entry — the position simply has no exchange-side protection.
   *
   * A stopLoss/takeProfit of 0 means that leg is switched off in settings
   * (stopLossPct/takeProfitPct = 0) — no order is placed and no alert fires.
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

    // Place one protective order, retrying once to ride out a transient blip.
    const place = async (label: 'SL' | 'TP', params: Record<string, unknown>): Promise<string | null> => {
      for (let attempt = 1; attempt <= 2; attempt++) {
        try {
          const order = await exchange.createOrder(symbol, 'market', closeSide, quantity, undefined, {
            ...params,
            reduceOnly: true,
          });
          return order.id ?? null;
        } catch (err) {
          this.logger.error(`[${mode}][${symbol}] วาง ${label} ครั้งที่ ${attempt} ไม่สำเร็จ: ${err.message}`);
          if (attempt < 2) await this.sleep(TradingService.PROTECTIVE_RETRY_MS);
        }
      }
      return null;
    };

    const slOrderId = stopLoss > 0
      ? await place('SL', { stopLossPrice: exchange.priceToPrecision(symbol, stopLoss) })
      : null;
    const tpOrderId = takeProfit > 0
      ? await place('TP', { takeProfitPrice: exchange.priceToPrecision(symbol, takeProfit) })
      : null;

    // A leveraged position with one-sided (or no) protection must not sit silently —
    // alert the operator to intervene rather than only logging. Legs switched off in
    // settings are not "missing" — alerting on them would cry wolf on every entry.
    const missing = [
      stopLoss > 0 && !slOrderId && 'SL',
      takeProfit > 0 && !tpOrderId && 'TP',
    ].filter(Boolean).join(' + ');
    if (missing) {
      await this.notificationService.sendError(
        `${symbol}: วาง protective order ${missing} ไม่สำเร็จหลัง retry — position อาจไม่มี ${missing} บน exchange`,
        mode,
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
        // warn — not debug: a failed cancel leaves a live reduceOnly order that
        // can close a future position at a stale trigger price
        this.logger.warn(
          `[${mode}][${position.symbol}] cancel protective order ${orderId} ไม่สำเร็จ: ${err.message}`,
        );
      }
    }
  }

  /**
   * Cancel stale reduceOnly SL/TP orders for a symbol that are no longer tied to
   * any open position in the DB. Stale orders accumulate when a close-path cancel
   * fails silently; once the price touches their trigger they market-close the
   * CURRENT position (see BTC 2026-07-15: a stale TP dumped a live long).
   * Called before opening a new position. Failures never block the entry.
   */
  private async sweepStaleProtectiveOrders(
    exchange: Exchange,
    symbol: string,
    mode: TradingMode,
  ): Promise<void> {
    try {
      const openOrders = await exchange.fetchOpenOrders(symbol);
      if (!openOrders.length) return;

      const positions = await this.positionRepo.find({ where: { status: 'open', mode, symbol } });
      const keep = new Set(
        positions.flatMap((p) => [p.slOrderId, p.tpOrderId]).filter(Boolean),
      );

      for (const order of openOrders) {
        const type = (order.type ?? '').toLowerCase().replace(/[_\s]/g, '');
        const isProtective =
          order.reduceOnly === true ||
          type === 'stopmarket' || type === 'takeprofitmarket' ||
          type === 'stop' || type === 'takeprofit';
        if (!isProtective || keep.has(order.id)) continue;

        try {
          await exchange.cancelOrder(order.id, symbol);
          this.logger.warn(
            `[${mode}][${symbol}] ยกเลิก stale protective order ${order.id} (${order.type} ${order.side})`,
          );
        } catch (err) {
          this.logger.warn(
            `[${mode}][${symbol}] cancel stale order ${order.id} ไม่สำเร็จ: ${err.message}`,
          );
        }
      }
    } catch (err) {
      this.logger.warn(`[${mode}][${symbol}] sweepStaleProtectiveOrders ไม่สำเร็จ: ${err.message}`);
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

      // กวาด SL/TP ค้างจาก position เก่าก่อนเปิดไม้ใหม่ — กัน order ผี trigger มาปิดไม้นี้
      await this.sweepStaleProtectiveOrders(exchange, symbol, mode);

      let entryPrice = currentPrice;
      let orderId: string | undefined;

      await exchange.setLeverage(s.leverage, symbol);
      const order = await exchange.createMarketBuyOrder(symbol, quantity, {
        reduceOnly: false,
      });
      entryPrice = order.average ?? currentPrice;
      orderId    = order.id;

      // pct 0 = ปิดขานั้นจาก settings — เก็บ 0 ไว้เป็น sentinel ใน position row
      const stopLoss   = s.stopLossPct   > 0 ? entryPrice * (1 - s.stopLossPct / 100)   : 0;
      const takeProfit = s.takeProfitPct > 0 ? entryPrice * (1 + s.takeProfitPct / 100) : 0;

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
        `[${mode}][${symbol}] OPEN LONG | Price=${entryPrice} | Qty=${quantity} | SL=${TradingService.fmtProtective(stopLoss)} | TP=${TradingService.fmtProtective(takeProfit)}`,
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
    reason: 'SIGNAL' | 'SL' | 'TP' | 'MANUAL',
    mode: TradingMode,
  ): Promise<boolean> {
    const symbol = position.symbol;
    const exchange = this.marketDataService.getExchange(mode);

    // Single-flight: atomically claim the position so a concurrent cron close and
    // a manual/API close can't both submit orders + write duplicate trade logs.
    const claim = await this.positionRepo.update(
      { id: position.id, status: 'open' },
      { status: 'closing' },
    );
    if (!claim.affected) {
      this.logger.warn(`[${mode}][${symbol}] position ${position.id} กำลังถูกปิดโดย path อื่น — ข้าม`);
      return false;
    }

    // Market-close FIRST, then cancel SL/TP. If the close order throws, the native
    // protective orders are still live on the exchange — roll the claim back so the
    // next signal retries instead of leaving an unprotected position.
    let exitPrice: number;
    try {
      const order = await exchange.createMarketSellOrder(symbol, position.quantity, {
        reduceOnly: true,
      });
      exitPrice = order.average ?? currentPrice;
    } catch (err) {
      this.logger.error(`[${mode}][${symbol}] closeLong error: ` + err.message);
      await this.positionRepo.update({ id: position.id, status: 'closing' }, { status: 'open' });
      return false;
    }

    // The position is now flat on-exchange. A bookkeeping failure past this point must
    // NOT revert to 'open' (that would churn reduceOnly-rejected orders); the stale
    // 'closing' row is reconciled by syncPositions/the boot reaper instead.
    try {
      await this.cancelProtectiveOrders(exchange, position, mode);

      const pnl       = (exitPrice - position.entryPrice) * position.quantity;
      const closeTime = new Date();

      await this.positionRepo.update(position.id, {
        closedPnl: pnl,
        closeTime,
        status: 'closed',
      });
      position.closedPnl = pnl;

      const action = reason === 'SL' ? 'SL_HIT' : reason === 'TP' ? 'TP_HIT' : 'CLOSE_LONG';
      await this.tradeLogRepo.save(
        this.tradeLogRepo.create({
          symbol,
          action,
          price:    exitPrice,
          quantity: position.quantity,
          pnl,
          zone,
          signal:   'SELL',
          mode,
        }),
      );

      this.logger.log(
        `[${mode}][${symbol}] CLOSE LONG (${reason}) | Price=${exitPrice} | PnL=${pnl.toFixed(2)} USDT`,
      );

      await this.notificationService.sendClosePosition(position, reason, exitPrice, mode);
      return true;
    } catch (err) {
      this.logger.error(`[${mode}][${symbol}] closeLong bookkeeping error: ` + err.message);
      return false;
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

      // กวาด SL/TP ค้างจาก position เก่าก่อนเปิดไม้ใหม่ — กัน order ผี trigger มาปิดไม้นี้
      await this.sweepStaleProtectiveOrders(exchange, symbol, mode);

      let entryPrice = currentPrice;
      let orderId: string | undefined;

      await exchange.setLeverage(s.leverage, symbol);
      const order = await exchange.createMarketSellOrder(symbol, quantity, {
        reduceOnly: false,
      });
      entryPrice = order.average ?? currentPrice;
      orderId    = order.id;

      // pct 0 = ปิดขานั้นจาก settings — เก็บ 0 ไว้เป็น sentinel ใน position row
      const stopLoss   = s.stopLossPct   > 0 ? entryPrice * (1 + s.stopLossPct / 100)   : 0;
      const takeProfit = s.takeProfitPct > 0 ? entryPrice * (1 - s.takeProfitPct / 100) : 0;

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
        `[${mode}][${symbol}] OPEN SHORT | Price=${entryPrice} | Qty=${quantity} | SL=${TradingService.fmtProtective(stopLoss)} | TP=${TradingService.fmtProtective(takeProfit)}`,
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
    reason: 'SIGNAL' | 'SL' | 'TP' | 'MANUAL',
    mode: TradingMode,
  ): Promise<boolean> {
    const symbol = position.symbol;
    const exchange = this.marketDataService.getExchange(mode);

    // Single-flight: atomically claim the position so a concurrent cron close and
    // a manual/API close can't both submit orders + write duplicate trade logs.
    const claim = await this.positionRepo.update(
      { id: position.id, status: 'open' },
      { status: 'closing' },
    );
    if (!claim.affected) {
      this.logger.warn(`[${mode}][${symbol}] position ${position.id} กำลังถูกปิดโดย path อื่น — ข้าม`);
      return false;
    }

    // Market-close FIRST, then cancel SL/TP. If the close order throws, the native
    // protective orders are still live on the exchange — roll the claim back so the
    // next signal retries instead of leaving an unprotected position.
    let exitPrice: number;
    try {
      const order = await exchange.createMarketBuyOrder(symbol, position.quantity, {
        reduceOnly: true,
      });
      exitPrice = order.average ?? currentPrice;
    } catch (err) {
      this.logger.error(`[${mode}][${symbol}] closeShort error: ` + err.message);
      await this.positionRepo.update({ id: position.id, status: 'closing' }, { status: 'open' });
      return false;
    }

    // The position is now flat on-exchange. A bookkeeping failure past this point must
    // NOT revert to 'open' (that would churn reduceOnly-rejected orders); the stale
    // 'closing' row is reconciled by syncPositions/the boot reaper instead.
    try {
      await this.cancelProtectiveOrders(exchange, position, mode);

      const pnl       = (position.entryPrice - exitPrice) * position.quantity;
      const closeTime = new Date();

      await this.positionRepo.update(position.id, {
        closedPnl: pnl,
        closeTime,
        status: 'closed',
      });
      position.closedPnl = pnl;

      const action = reason === 'SL' ? 'SL_HIT' : reason === 'TP' ? 'TP_HIT' : 'CLOSE_SHORT';
      await this.tradeLogRepo.save(
        this.tradeLogRepo.create({
          symbol,
          action,
          price:    exitPrice,
          quantity: position.quantity,
          pnl,
          zone,
          signal:   'BUY',
          mode,
        }),
      );

      this.logger.log(
        `[${mode}][${symbol}] CLOSE SHORT (${reason}) | Price=${exitPrice} | PnL=${pnl.toFixed(2)} USDT`,
      );

      await this.notificationService.sendClosePosition(position, reason, exitPrice, mode);
      return true;
    } catch (err) {
      this.logger.error(`[${mode}][${symbol}] closeShort bookkeeping error: ` + err.message);
      return false;
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
        await this.closeLong(pos, currentPrice, CDCZone.NONE, 'MANUAL', mode);
      } else if (pos.side === 'short') {
        await this.closeShort(pos, currentPrice, CDCZone.NONE, 'MANUAL', mode);
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
      await this.closeLong(position as unknown as Position, currentPrice, CDCZone.NONE, 'MANUAL', mode);
    } else {
      await this.closeShort(position as unknown as Position, currentPrice, CDCZone.NONE, 'MANUAL', mode);
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
          // Atomically claim the close so overlapping syncs (cron + every dashboard
          // /status poll) can't both record it — otherwise the SYNC_CLOSE trade log
          // is written twice and PnL is counted twice in getTotalPnl. Claim to
          // 'closing' (not straight to 'closed'): if the pnl fetch or ledger write
          // below throws, the row stays 'closing' for the boot reaper to revert and a
          // later sync to re-record, rather than becoming 'closed' with no ledger entry.
          const claim = await this.positionRepo.update(
            { id: localPos.id, status: 'open' },
            { status: 'closing' },
          );
          if (!claim.affected) continue; // another concurrent sync already handled this position

          this.logger.warn(`[${mode}][${localPos.symbol}] Position ${localPos.side} is actually closed on Binance. Updating DB to sync...`);

          // The close happened on-exchange (SL/TP filled or manual) — cancel the surviving sibling order
          await this.cancelProtectiveOrders(exchange, localPos, mode);

          // Prefer actual realized PnL from the income endpoint; fall back to a
          // mark-price estimate so the ledger never records a hard-coded 0.
          const openTimeMs = new Date(localPos.openTime).getTime();
          const realized = await this.fetchRealizedPnl(exchange, localPos.symbol, openTimeMs);

          // The ledger needs a close price no matter where the PnL came from. This used to
          // be resolved only on the estimate path, so every SYNC_CLOSE that got a realized
          // PnL was written with price 0 — which the dashboard then showed as the close
          // price and the chart used to place the marker.
          let price: number;
          try {
            const { last } = await this.marketDataService.fetchTicker(localPos.symbol);
            price = Number.isFinite(last) ? last : localPos.entryPrice;
          } catch {
            price = localPos.entryPrice;
          }

          let pnl: number;
          if (realized !== null) {
            pnl = realized;
          } else {
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

          // syncPositions is the SL/TP path (native exchange orders fill
          // on Binance, not through closeLong/closeShort), so notify here too.
          localPos.closedPnl = pnl;
          await this.notificationService.sendClosePosition(localPos, 'SYNC', price || localPos.entryPrice, mode);
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
      // stopLoss/takeProfit of 0 = leg switched off in settings. Without this guard the
      // comparisons below are trivially true (price >= 0), instant-closing every position.
      if (position.side === 'long') {
        if (position.stopLoss > 0 && currentPrice <= position.stopLoss) {
          this.logger.warn(`[${mode}][${symbol}] Stop Loss triggered! Price=${currentPrice} SL=${position.stopLoss}`);
          await this.closeLong(position, currentPrice, zone, 'SL', mode);
        } else if (position.takeProfit > 0 && currentPrice >= position.takeProfit) {
          this.logger.log(`[${mode}][${symbol}] Take Profit triggered! Price=${currentPrice} TP=${position.takeProfit}`);
          await this.closeLong(position, currentPrice, zone, 'TP', mode);
        }
      } else if (position.side === 'short') {
        if (position.stopLoss > 0 && currentPrice >= position.stopLoss) {
          this.logger.warn(`[${mode}][${symbol}] Stop Loss triggered (Short)! Price=${currentPrice} SL=${position.stopLoss}`);
          await this.closeShort(position, currentPrice, zone, 'SL', mode);
        } else if (position.takeProfit > 0 && currentPrice <= position.takeProfit) {
          this.logger.log(`[${mode}][${symbol}] Take Profit triggered (Short)! Price=${currentPrice} TP=${position.takeProfit}`);
          await this.closeShort(position, currentPrice, zone, 'TP', mode);
        }
      }
    }
  }
}
