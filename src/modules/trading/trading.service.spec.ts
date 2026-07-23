import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { TradingService } from './trading.service';
import { MarketDataService } from '../market-data/market-data.service';
import { TradingSettingsService } from '../trading-settings/trading-settings.service';
import { NotificationService } from '../notification/notification.service';
import { PositionEntity } from '../../database/entities/position.entity';
import { TradeLogEntity } from '../../database/entities/trade-log.entity';
import { CDCZone, Position } from '../../common/types';

// ─── helpers ─────────────────────────────────────────────────────────────────

const DEFAULT_SETTINGS = {
  symbol: 'BTC/USDT:USDT', timeframe: '1h',
  leverage: 5, orderSizeUsdt: 100, maxPositions: 1,
  stopLossPct: 2.0, takeProfitPct: 4.0,
  emaFast: 12, emaSlow: 26, status: 'on',
};

function makeSettingsService(): jest.Mocked<Partial<TradingSettingsService>> {
  return {
    getSettings: jest.fn().mockResolvedValue(DEFAULT_SETTINGS),
  } as any;
}

function makeOpenPosition(overrides: Partial<Position> = {}): Position {
  return {
    id:          'pos-1',
    symbol:      'BTC/USDT:USDT',
    side:        'long',
    entryPrice:  50_000,
    quantity:    0.01,
    stopLoss:    49_000,
    takeProfit:  52_000,
    openTime:    new Date('2024-01-01'),
    status:      'open',
    mode:        'sandbox',
    ...overrides,
  } as Position;
}

// ─── repo mock factory ───────────────────────────────────────────────────────

function makePositionRepo() {
  return {
    count:  jest.fn(),
    find:   jest.fn(),
    create: jest.fn((dto) => dto),
    save:   jest.fn((entity) => Promise.resolve({ id: 'pos-saved', ...entity })),
    update: jest.fn().mockResolvedValue({ affected: 1 }),
  };
}

function makeTradeLogRepo() {
  const qb = {
    select:  jest.fn().mockReturnThis(),
    where:   jest.fn().mockReturnThis(),
    getRawOne: jest.fn().mockResolvedValue({ total: '0' }),
  };
  return {
    find:              jest.fn().mockResolvedValue([]),
    create:            jest.fn((dto) => dto),
    save:              jest.fn((entity) => Promise.resolve({ id: 'log-1', ...entity })),
    createQueryBuilder: jest.fn().mockReturnValue(qb),
  };
}

function makeFakeExchange() {
  return {
    markets:               { 'BTC/USDT:USDT': {} },
    loadMarkets:           jest.fn().mockResolvedValue(undefined),
    amountToPrecision:     jest.fn((_symbol: string, qty: number) => qty.toFixed(3)),
    priceToPrecision:      jest.fn((_symbol: string, price: number) => String(price)),
    setLeverage:           jest.fn().mockResolvedValue(undefined),
    createMarketBuyOrder:  jest.fn().mockResolvedValue({ average: 50_100, id: 'order-live-1' }),
    createMarketSellOrder: jest.fn().mockResolvedValue({}),
    createOrder:           jest.fn().mockResolvedValue({ id: 'protective-1' }),
    cancelOrder:           jest.fn().mockResolvedValue(undefined),
    fetchOpenOrders:       jest.fn().mockResolvedValue([]),
    fetchPositions:        jest.fn().mockResolvedValue([]),
    fapiPrivateGetIncome:  jest.fn().mockResolvedValue([{ income: '12.5' }]),
    marketId:              jest.fn((symbol: string) => symbol.replace('/', '').replace(':USDT', '')),
  };
}

function makeMarketDataService(exchange = makeFakeExchange()): jest.Mocked<Partial<MarketDataService>> {
  return {
    getExchange:  jest.fn().mockReturnValue(exchange),
    fetchTicker:  jest.fn().mockResolvedValue({ bid: 50_000, ask: 50_100, last: 50_050 }),
  } as any;
}

function makeNotificationService(): jest.Mocked<Partial<NotificationService>> {
  return {
    sendOpenPosition:  jest.fn().mockResolvedValue(undefined),
    sendClosePosition: jest.fn().mockResolvedValue(undefined),
    sendError:         jest.fn().mockResolvedValue(undefined),
  } as any;
}

// ─── test setup ──────────────────────────────────────────────────────────────

describe('TradingService', () => {
  let service: TradingService;
  let positionRepo: ReturnType<typeof makePositionRepo>;
  let tradeLogRepo: ReturnType<typeof makeTradeLogRepo>;
  let exchange: ReturnType<typeof makeFakeExchange>;
  let notificationService: ReturnType<typeof makeNotificationService>;

  beforeEach(async () => {
    positionRepo = makePositionRepo();
    tradeLogRepo = makeTradeLogRepo();
    exchange     = makeFakeExchange();
    notificationService = makeNotificationService();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TradingService,
        { provide: getRepositoryToken(PositionEntity),  useValue: positionRepo },
        { provide: getRepositoryToken(TradeLogEntity),  useValue: tradeLogRepo },
        { provide: MarketDataService,                    useValue: makeMarketDataService(exchange) },
        { provide: TradingSettingsService,               useValue: makeSettingsService() },
        { provide: NotificationService,                  useValue: notificationService },
      ],
    }).compile();

    service = module.get<TradingService>(TradingService);
  });

  // ── hasOpenPosition() ────────────────────────────────────────────────────

  describe('hasOpenPosition()', () => {
    it('returns true when at least one open position exists for the mode', async () => {
      positionRepo.count.mockResolvedValue(1);
      expect(await service.hasOpenPosition('sandbox', 'BTC/USDT:USDT')).toBe(true);
    });

    it('returns false when no open positions exist for the mode', async () => {
      positionRepo.count.mockResolvedValue(0);
      expect(await service.hasOpenPosition('sandbox', 'BTC/USDT:USDT')).toBe(false);
    });

    it('queries with the correct mode filter', async () => {
      positionRepo.count.mockResolvedValue(0);
      await service.hasOpenPosition('live', 'BTC/USDT:USDT');
      expect(positionRepo.count).toHaveBeenCalledWith({ where: { status: 'open', mode: 'live', symbol: 'BTC/USDT:USDT' } });
    });
  });

  // ── getOpenPositions() ───────────────────────────────────────────────────

  describe('getOpenPositions()', () => {
    it('returns an empty array when no positions are open', async () => {
      positionRepo.find.mockResolvedValue([]);
      expect(await service.getOpenPositions('sandbox')).toEqual([]);
    });

    it('returns the open positions for the given mode', async () => {
      const row = { id: 'p1', status: 'open', mode: 'sandbox' };
      positionRepo.find.mockResolvedValue([row]);
      const result = await service.getOpenPositions('sandbox');
      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({ id: 'p1' });
    });
  });

  // ── getTradeHistory() ────────────────────────────────────────────────────

  describe('getTradeHistory()', () => {
    it('returns empty array when there are no trade logs', async () => {
      tradeLogRepo.find.mockResolvedValue([]);
      expect(await service.getTradeHistory('live')).toEqual([]);
    });

    it('returns trade logs ordered by timestamp descending', async () => {
      const logs = [
        { id: 'l2', timestamp: new Date('2024-01-02'), action: 'CLOSE_LONG' },
        { id: 'l1', timestamp: new Date('2024-01-01'), action: 'OPEN_LONG' },
      ];
      tradeLogRepo.find.mockResolvedValue(logs);
      const result = await service.getTradeHistory('live');
      expect(result[0].id).toBe('l2');
    });
  });

  // ── getTotalPnl() ────────────────────────────────────────────────────────

  describe('getTotalPnl()', () => {
    it('returns 0 when there are no trade logs', async () => {
      const qb = tradeLogRepo.createQueryBuilder();
      qb.getRawOne.mockResolvedValue({ total: '0' });
      expect(await service.getTotalPnl('sandbox')).toBe(0);
    });

    it('returns the parsed float sum of pnl values', async () => {
      const qb = tradeLogRepo.createQueryBuilder();
      qb.getRawOne.mockResolvedValue({ total: '123.45' });
      expect(await service.getTotalPnl('live')).toBe(123.45);
    });
  });

  // ── sweepStaleProtectiveOrders() via openLong ─────────────────────────────

  describe('stale protective order sweep on open', () => {
    const SYMBOL = 'BTC/USDT:USDT';
    const staleStop = { id: 'stale-sl', type: 'stop_market', side: 'sell', reduceOnly: true };
    const staleTp   = { id: 'stale-tp', type: 'take_profit_market', side: 'sell', reduceOnly: true };
    const entryOrder = { id: 'entry-1', type: 'market', side: 'buy', reduceOnly: false };

    beforeEach(() => {
      positionRepo.count.mockResolvedValue(0);
    });

    it('cancels reduceOnly conditional orders not tied to any open DB position', async () => {
      exchange.fetchOpenOrders.mockResolvedValue([staleStop, staleTp]);
      positionRepo.find.mockResolvedValue([]);

      await service.openLong(50_000, CDCZone.STRONG_BULL, 'sandbox', SYMBOL);

      expect(exchange.cancelOrder).toHaveBeenCalledWith('stale-sl', SYMBOL);
      expect(exchange.cancelOrder).toHaveBeenCalledWith('stale-tp', SYMBOL);
    });

    it('keeps orders whose ids belong to open positions in the DB', async () => {
      exchange.fetchOpenOrders.mockResolvedValue([staleStop, staleTp]);
      positionRepo.find.mockResolvedValue([
        { id: 'p1', status: 'open', slOrderId: 'stale-sl', tpOrderId: 'stale-tp' },
      ]);

      await service.openLong(50_000, CDCZone.STRONG_BULL, 'sandbox', SYMBOL);

      expect(exchange.cancelOrder).not.toHaveBeenCalled();
    });

    it('does not cancel non-protective (entry) orders', async () => {
      exchange.fetchOpenOrders.mockResolvedValue([entryOrder]);
      positionRepo.find.mockResolvedValue([]);

      await service.openLong(50_000, CDCZone.STRONG_BULL, 'sandbox', SYMBOL);

      expect(exchange.cancelOrder).not.toHaveBeenCalled();
    });

    it('still opens the position when the sweep itself fails', async () => {
      exchange.fetchOpenOrders.mockRejectedValue(new Error('exchange down'));

      const result = await service.openLong(50_000, CDCZone.STRONG_BULL, 'sandbox', SYMBOL);

      expect(result).not.toBeNull();
      expect(exchange.createMarketBuyOrder).toHaveBeenCalled();
    });

    it('still opens the position when cancelling a stale order fails', async () => {
      exchange.fetchOpenOrders.mockResolvedValue([staleStop]);
      positionRepo.find.mockResolvedValue([]);
      exchange.cancelOrder.mockRejectedValue(new Error('-2011 Unknown order sent'));

      const result = await service.openLong(50_000, CDCZone.STRONG_BULL, 'sandbox', SYMBOL);

      expect(result).not.toBeNull();
      expect(exchange.createMarketBuyOrder).toHaveBeenCalled();
    });
  });

  // ── openLong() — sandbox mode ─────────────────────────────────────────────

  describe('openLong() — sandbox mode', () => {
    beforeEach(() => {
      positionRepo.count.mockResolvedValue(0);
    });

    it('saves a new open position to the repository', async () => {
      const result = await service.openLong(50_000, CDCZone.STRONG_BULL, 'sandbox', 'BTC/USDT:USDT');
      expect(positionRepo.save).toHaveBeenCalled();
      expect(result).toMatchObject({ side: 'long', status: 'open', mode: 'sandbox' });
    });

    it('writes an OPEN_LONG trade log entry', async () => {
      await service.openLong(50_000, CDCZone.STRONG_BULL, 'sandbox', 'BTC/USDT:USDT');
      expect(tradeLogRepo.save).toHaveBeenCalled();
      const savedLog = (tradeLogRepo.create as jest.Mock).mock.calls[0][0];
      expect(savedLog.action).toBe('OPEN_LONG');
      expect(savedLog.signal).toBe('BUY');
    });

    it('calculates stopLoss and takeProfit relative to fill price', async () => {
      // exchange fill price is 50_100 (mock default: order.average = 50_100)
      const fillPrice = 50_100;
      await service.openLong(50_000, CDCZone.STRONG_BULL, 'sandbox', 'BTC/USDT:USDT');
      const savedPos = (positionRepo.create as jest.Mock).mock.calls[0][0];
      expect(savedPos.stopLoss).toBeCloseTo(fillPrice * 0.98, 0);
      expect(savedPos.takeProfit).toBeCloseTo(fillPrice * 1.04, 0);
    });

    it('places a market buy order via the exchange in sandbox mode', async () => {
      await service.openLong(50_000, CDCZone.STRONG_BULL, 'sandbox', 'BTC/USDT:USDT');
      expect(exchange.createMarketBuyOrder).toHaveBeenCalled();
      const savedLog = (tradeLogRepo.create as jest.Mock).mock.calls[0][0];
      expect(savedLog.orderId).toBe('order-live-1');
    });

    it('returns null when maxPositions limit is already reached', async () => {
      positionRepo.count.mockResolvedValue(1);
      const result = await service.openLong(50_000, CDCZone.STRONG_BULL, 'sandbox', 'BTC/USDT:USDT');
      expect(result).toBeNull();
      expect(positionRepo.save).not.toHaveBeenCalled();
    });

    it('rethrows when positionRepo.save rejects so the strategy retries next candle', async () => {
      positionRepo.save.mockRejectedValue(new Error('DB error'));
      await expect(
        service.openLong(50_000, CDCZone.STRONG_BULL, 'sandbox', 'BTC/USDT:USDT'),
      ).rejects.toThrow('DB error');
    });
  });

  // ── openLong() — live mode ────────────────────────────────────────────────

  describe('openLong() — live mode', () => {
    beforeEach(() => {
      positionRepo.count.mockResolvedValue(0);
    });

    it('calls setLeverage on the exchange before placing an order', async () => {
      await service.openLong(50_000, CDCZone.STRONG_BULL, 'live', 'BTC/USDT:USDT');
      expect(exchange.setLeverage).toHaveBeenCalledWith(5, 'BTC/USDT:USDT');
    });

    it('calls createMarketBuyOrder on the exchange', async () => {
      await service.openLong(50_000, CDCZone.STRONG_BULL, 'live', 'BTC/USDT:USDT');
      expect(exchange.createMarketBuyOrder).toHaveBeenCalled();
    });

    it('uses the exchange fill price (order.average) as entryPrice', async () => {
      exchange.createMarketBuyOrder.mockResolvedValue({ average: 50_200, id: 'ord-x' });
      await service.openLong(50_000, CDCZone.STRONG_BULL, 'live', 'BTC/USDT:USDT');
      const savedPos = (positionRepo.create as jest.Mock).mock.calls[0][0];
      expect(savedPos.entryPrice).toBe(50_200);
    });

    it('falls back to currentPrice when order.average is null', async () => {
      exchange.createMarketBuyOrder.mockResolvedValue({ average: null, id: 'ord-x' });
      await service.openLong(50_000, CDCZone.STRONG_BULL, 'live', 'BTC/USDT:USDT');
      const savedPos = (positionRepo.create as jest.Mock).mock.calls[0][0];
      expect(savedPos.entryPrice).toBe(50_000);
    });

    it('rethrows when the exchange throws so the strategy retries next candle', async () => {
      exchange.setLeverage.mockRejectedValue(new Error('network error'));
      await expect(
        service.openLong(50_000, CDCZone.STRONG_BULL, 'live', 'BTC/USDT:USDT'),
      ).rejects.toThrow('network error');
    });
  });

  // ── validateOrderSize() ───────────────────────────────────────────────────

  describe('validateOrderSize()', () => {
    // ticker mock: last = 50_050 — qty = orderSize×lev/50_050 truncated to 3 decimals
    const withMarket = (market: object) => {
      exchange.markets = { 'BTC/USDT:USDT': market } as any;
    };

    it('passes when notional after lot-size truncation meets the exchange minimum', async () => {
      withMarket({ limits: { cost: { min: 50 } }, precision: { amount: 0.001 } });
      // 100 × 5 / 50_050 = 0.00999 → 0.009 → notional 450.45 ≥ 50
      await expect(
        service.validateOrderSize('sandbox', 'BTC/USDT:USDT', 100, 5),
      ).resolves.toBeUndefined();
    });

    it('throws BadRequestException with a suggested minimum when notional falls below minCost', async () => {
      withMarket({ limits: { cost: { min: 50 } }, precision: { amount: 0.001 } });
      // 4 × 5 / 50_050 = 0.0004 → rounds to 0.000 → notional 0 < 50
      await expect(
        service.validateOrderSize('sandbox', 'BTC/USDT:USDT', 4, 5),
      ).rejects.toThrow(/ต่ำกว่าขั้นต่ำ 50 USDT/);
    });

    it('passes when the market defines no minCost limit', async () => {
      withMarket({});
      await expect(
        service.validateOrderSize('sandbox', 'BTC/USDT:USDT', 100, 5),
      ).resolves.toBeUndefined();
    });

    it('skips validation instead of blocking the save when the ticker fetch fails', async () => {
      withMarket({ limits: { cost: { min: 50 } }, precision: { amount: 0.001 } });
      (service as any).marketDataService.fetchTicker.mockRejectedValue(new Error('timeout'));
      await expect(
        service.validateOrderSize('sandbox', 'BTC/USDT:USDT', 10, 5),
      ).resolves.toBeUndefined();
    });
  });

  // ── closeLong() — sandbox mode ────────────────────────────────────────────

  describe('closeLong() — sandbox mode', () => {
    it('updates position status to "closed" with pnl and closeTime', async () => {
      const pos = makeOpenPosition({ entryPrice: 50_000, quantity: 0.01 });
      await service.closeLong(pos, 51_000, CDCZone.BEAR, 'SIGNAL', 'sandbox');
      expect(positionRepo.update).toHaveBeenCalledWith(
        'pos-1',
        expect.objectContaining({ status: 'closed', closedPnl: expect.any(Number) }),
      );
    });

    it('computes pnl as (currentPrice - entryPrice) * quantity', async () => {
      const pos = makeOpenPosition({ entryPrice: 50_000, quantity: 0.02 });
      await service.closeLong(pos, 51_000, CDCZone.BEAR, 'SIGNAL', 'sandbox');
      const closedUpdate = (positionRepo.update as jest.Mock).mock.calls.find(
        ([, patch]) => patch?.status === 'closed',
      );
      expect(closedUpdate[1].closedPnl).toBeCloseTo(20, 5);
    });

    it('writes a CLOSE_LONG trade log entry when reason is SIGNAL', async () => {
      const pos = makeOpenPosition();
      await service.closeLong(pos, 51_000, CDCZone.BEAR, 'SIGNAL', 'sandbox');
      const logArg = (tradeLogRepo.create as jest.Mock).mock.calls[0][0];
      expect(logArg.action).toBe('CLOSE_LONG');
    });

    it('writes an SL_HIT trade log entry when reason is SL', async () => {
      const pos = makeOpenPosition();
      await service.closeLong(pos, 49_000, CDCZone.BEAR, 'SL', 'sandbox');
      const logArg = (tradeLogRepo.create as jest.Mock).mock.calls[0][0];
      expect(logArg.action).toBe('SL_HIT');
    });

    it('writes a TP_HIT trade log entry when reason is TP', async () => {
      const pos = makeOpenPosition();
      await service.closeLong(pos, 52_000, CDCZone.BEAR, 'TP', 'sandbox');
      const logArg = (tradeLogRepo.create as jest.Mock).mock.calls[0][0];
      expect(logArg.action).toBe('TP_HIT');
    });

    it('calls createMarketSellOrder via the exchange in sandbox mode', async () => {
      const pos = makeOpenPosition();
      await service.closeLong(pos, 51_000, CDCZone.BEAR, 'SIGNAL', 'sandbox');
      expect(exchange.createMarketSellOrder).toHaveBeenCalledWith(
        'BTC/USDT:USDT', 0.01, { reduceOnly: true },
      );
    });

    it('computes negative pnl correctly when price is below entry', async () => {
      const pos = makeOpenPosition({ entryPrice: 50_000, quantity: 0.01 });
      await service.closeLong(pos, 49_000, CDCZone.BEAR, 'SL', 'sandbox');
      const closedUpdate = (positionRepo.update as jest.Mock).mock.calls.find(
        ([, patch]) => patch?.status === 'closed',
      );
      expect(closedUpdate[1].closedPnl).toBeCloseTo(-10, 5);
    });

    it('uses the close-order fill price (order.average) for pnl, not the currentPrice arg', async () => {
      // real fill 50_900 differs from the 51_000 currentPrice passed in (slippage)
      exchange.createMarketSellOrder.mockResolvedValue({ average: 50_900 });
      const pos = makeOpenPosition({ entryPrice: 50_000, quantity: 0.02 });
      await service.closeLong(pos, 51_000, CDCZone.BEAR, 'SIGNAL', 'sandbox');
      const closedUpdate = (positionRepo.update as jest.Mock).mock.calls.find(
        ([, patch]) => patch?.status === 'closed',
      );
      expect(closedUpdate[1].closedPnl).toBeCloseTo((50_900 - 50_000) * 0.02, 5);
      const logArg = (tradeLogRepo.create as jest.Mock).mock.calls[0][0];
      expect(logArg.price).toBe(50_900);
    });
  });

  // ── closeLong() — live mode ───────────────────────────────────────────────

  describe('closeLong() — live mode', () => {
    it('calls createMarketSellOrder on the exchange with reduceOnly=true', async () => {
      const pos = makeOpenPosition({ quantity: 0.01, mode: 'live' });
      await service.closeLong(pos, 51_000, CDCZone.BEAR, 'SIGNAL', 'live');
      expect(exchange.createMarketSellOrder).toHaveBeenCalledWith(
        'BTC/USDT:USDT',
        0.01,
        { reduceOnly: true },
      );
    });

    it('leaves SL/TP intact and rolls the claim back when the close order fails', async () => {
      exchange.createMarketSellOrder.mockRejectedValue(new Error('exchange down'));
      const pos = makeOpenPosition({ mode: 'live', slOrderId: 'sl-1', tpOrderId: 'tp-1' });
      const ok = await service.closeLong(pos, 51_000, CDCZone.BEAR, 'SIGNAL', 'live');

      expect(ok).toBe(false);
      // T1 invariant: protective orders must NOT be cancelled on a failed close
      expect(exchange.cancelOrder).not.toHaveBeenCalled();
      // no phantom close recorded
      expect(tradeLogRepo.save).not.toHaveBeenCalled();
      // claim rolled back to 'open' so the next signal retries
      expect(positionRepo.update).toHaveBeenCalledWith(
        { id: 'pos-1', status: 'closing' },
        { status: 'open' },
      );
    });

    it('returns false without touching the exchange when the position is already being closed', async () => {
      positionRepo.update.mockResolvedValueOnce({ affected: 0 }); // claim loses the race
      const pos = makeOpenPosition({ mode: 'live' });
      const ok = await service.closeLong(pos, 51_000, CDCZone.BEAR, 'SIGNAL', 'live');

      expect(ok).toBe(false);
      expect(exchange.createMarketSellOrder).not.toHaveBeenCalled();
      expect(tradeLogRepo.save).not.toHaveBeenCalled();
    });
  });

  // ── close notifications (live gate) ───────────────────────────────────────

  describe('close notifications', () => {
    it('notifies on close in live mode with the given reason', async () => {
      const pos = makeOpenPosition({ mode: 'live' });
      await service.closeLong(pos, 51_000, CDCZone.BEAR, 'SIGNAL', 'live');
      expect(notificationService.sendClosePosition).toHaveBeenCalledWith(pos, 'SIGNAL', 51_000);
    });

    it('does NOT notify on close in sandbox mode', async () => {
      const pos = makeOpenPosition({ mode: 'sandbox' });
      await service.closeLong(pos, 51_000, CDCZone.BEAR, 'SIGNAL', 'sandbox');
      expect(notificationService.sendClosePosition).not.toHaveBeenCalled();
    });

    it('passes the real pnl on the position to the notifier (not 0)', async () => {
      const pos = makeOpenPosition({ entryPrice: 50_000, quantity: 0.02, mode: 'live' });
      await service.closeLong(pos, 51_000, CDCZone.BEAR, 'SIGNAL', 'live');
      const notified = (notificationService.sendClosePosition as jest.Mock).mock.calls[0][0];
      expect(notified.closedPnl).toBeCloseTo(20, 5);
    });

    it('forwards a MANUAL reason to the notifier', async () => {
      const pos = makeOpenPosition({ mode: 'live' });
      await service.closeLong(pos, 51_000, CDCZone.BEAR, 'MANUAL', 'live');
      expect(notificationService.sendClosePosition).toHaveBeenCalledWith(pos, 'MANUAL', 51_000);
    });

    it('notifies on closeShort in live mode with the exchange fill price', async () => {
      // createMarketBuyOrder mock fills at 50_100 (order.average) — T3 uses the real
      // fill price, not the currentPrice argument
      const pos = makeOpenPosition({ side: 'short', mode: 'live' });
      await service.closeShort(pos, 49_000, CDCZone.BULL, 'TP', 'live');
      expect(notificationService.sendClosePosition).toHaveBeenCalledWith(pos, 'TP', 50_100);
    });

    it('does NOT notify when the close fails on-exchange', async () => {
      exchange.createMarketSellOrder.mockRejectedValue(new Error('exchange down'));
      const pos = makeOpenPosition({ mode: 'live' });
      await service.closeLong(pos, 51_000, CDCZone.BEAR, 'SIGNAL', 'live');
      expect(notificationService.sendClosePosition).not.toHaveBeenCalled();
    });

    it('notifies with reason SYNC and realized pnl when a live position closed on-exchange', async () => {
      const pos = makeOpenPosition({ mode: 'live', entryPrice: 50_000, quantity: 0.01 });
      positionRepo.find.mockResolvedValue([pos]);
      await service.syncPositions('live', 'BTC/USDT:USDT');
      expect(notificationService.sendClosePosition).toHaveBeenCalledTimes(1);
      const [notified, reason] = (notificationService.sendClosePosition as jest.Mock).mock.calls[0];
      expect(reason).toBe('SYNC');
      expect(notified.closedPnl).toBeCloseTo(12.5, 5);
    });

    it('does NOT notify on sync-close in sandbox mode', async () => {
      const pos = makeOpenPosition({ mode: 'sandbox' });
      positionRepo.find.mockResolvedValue([pos]);
      await service.syncPositions('sandbox', 'BTC/USDT:USDT');
      expect(notificationService.sendClosePosition).not.toHaveBeenCalled();
    });
  });

  // ── syncPositions() concurrency guard ─────────────────────────────────────

  describe('syncPositions() single-flight', () => {
    it('does not record the close when the atomic claim is lost to a concurrent sync', async () => {
      const pos = makeOpenPosition({ mode: 'live', entryPrice: 50_000, quantity: 0.01 });
      positionRepo.find.mockResolvedValue([pos]);
      // remote reports the position flat, but another sync already claimed the close
      positionRepo.update.mockResolvedValue({ affected: 0 });

      await service.syncPositions('live', 'BTC/USDT:USDT');

      expect(tradeLogRepo.save).not.toHaveBeenCalled();
      expect(notificationService.sendClosePosition).not.toHaveBeenCalled();
    });
  });

  // ── placeProtectiveOrders() via openLong — partial-failure alert ──────────

  describe('protective order placement', () => {
    beforeEach(() => {
      positionRepo.count.mockResolvedValue(0);
      // skip the real 2s retry backoff
      jest.spyOn(service as any, 'sleep').mockResolvedValue(undefined);
    });

    it('alerts on a failed SL in live mode after retrying, and still opens the position', async () => {
      // SL createOrder rejects both attempts; TP succeeds
      exchange.createOrder
        .mockRejectedValueOnce(new Error('blip'))
        .mockRejectedValueOnce(new Error('blip'))
        .mockResolvedValue({ id: 'tp-1' });

      const result = await service.openLong(50_000, CDCZone.STRONG_BULL, 'live', 'BTC/USDT:USDT');

      expect(result).not.toBeNull();
      const savedPos = (positionRepo.create as jest.Mock).mock.calls[0][0];
      expect(savedPos.slOrderId).toBeNull();
      expect(savedPos.tpOrderId).toBe('tp-1');
      expect(notificationService.sendError).toHaveBeenCalledTimes(1);
      expect((notificationService.sendError as jest.Mock).mock.calls[0][0]).toMatch(/SL/);
    });

    it('does not alert when both protective orders are placed', async () => {
      exchange.createOrder.mockResolvedValue({ id: 'ok' });
      await service.openLong(50_000, CDCZone.STRONG_BULL, 'live', 'BTC/USDT:USDT');
      expect(notificationService.sendError).not.toHaveBeenCalled();
    });
  });

  // ── boot reaper (onApplicationBootstrap) ──────────────────────────────────

  describe('onApplicationBootstrap()', () => {
    it("reverts stranded 'closing' rows back to 'open' for reconciliation", async () => {
      positionRepo.update.mockResolvedValue({ affected: 2 });
      await service.onApplicationBootstrap();
      expect(positionRepo.update).toHaveBeenCalledWith(
        { status: 'closing' },
        { status: 'open' },
      );
    });
  });

  // ── checkSLTP() ──────────────────────────────────────────────────────────

  describe('checkSLTP()', () => {
    it('does nothing when there are no open positions', async () => {
      positionRepo.find.mockResolvedValue([]);
      await service.checkSLTP(49_000, CDCZone.BEAR, 'sandbox', 'BTC/USDT:USDT');
      expect(positionRepo.update).not.toHaveBeenCalled();
    });

    it('triggers closeLong with reason SL when price is at or below stopLoss', async () => {
      const pos = makeOpenPosition({ entryPrice: 50_000, stopLoss: 49_000, takeProfit: 52_000 });
      positionRepo.find.mockResolvedValue([pos]);
      await service.checkSLTP(49_000, CDCZone.BEAR, 'sandbox', 'BTC/USDT:USDT');
      const logArg = (tradeLogRepo.create as jest.Mock).mock.calls[0][0];
      expect(logArg.action).toBe('SL_HIT');
    });

    it('triggers closeLong with reason TP when price is at or above takeProfit', async () => {
      const pos = makeOpenPosition({ entryPrice: 50_000, stopLoss: 49_000, takeProfit: 52_000 });
      positionRepo.find.mockResolvedValue([pos]);
      await service.checkSLTP(52_000, CDCZone.STRONG_BULL, 'sandbox', 'BTC/USDT:USDT');
      const logArg = (tradeLogRepo.create as jest.Mock).mock.calls[0][0];
      expect(logArg.action).toBe('TP_HIT');
    });

    it('does not trigger SL or TP when price is between the two levels', async () => {
      const pos = makeOpenPosition({ entryPrice: 50_000, stopLoss: 49_000, takeProfit: 52_000 });
      positionRepo.find.mockResolvedValue([pos]);
      await service.checkSLTP(50_500, CDCZone.STRONG_BULL, 'sandbox', 'BTC/USDT:USDT');
      expect(positionRepo.update).not.toHaveBeenCalled();
    });

    it('does not trigger SL or TP for a short when price is between the two levels', async () => {
      const shortPos = makeOpenPosition({ side: 'short', stopLoss: 51_000, takeProfit: 48_000 });
      positionRepo.find.mockResolvedValue([shortPos]);
      await service.checkSLTP(50_500, CDCZone.STRONG_BEAR, 'sandbox', 'BTC/USDT:USDT');
      expect(positionRepo.update).not.toHaveBeenCalled();
    });
  });
});
