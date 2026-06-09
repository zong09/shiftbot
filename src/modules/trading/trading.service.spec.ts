import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { TradingService } from './trading.service';
import { MarketDataService } from '../market-data/market-data.service';
import { TradingSettingsService } from '../trading-settings/trading-settings.service';
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
    update: jest.fn().mockResolvedValue(undefined),
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
    setLeverage:           jest.fn().mockResolvedValue(undefined),
    createMarketBuyOrder:  jest.fn().mockResolvedValue({ average: 50_100, id: 'order-live-1' }),
    createMarketSellOrder: jest.fn().mockResolvedValue({}),
  };
}

function makeMarketDataService(exchange = makeFakeExchange()): jest.Mocked<Partial<MarketDataService>> {
  return {
    getExchange:  jest.fn().mockReturnValue(exchange),
    fetchTicker:  jest.fn().mockResolvedValue({ bid: 50_000, ask: 50_100, last: 50_050 }),
  } as any;
}

// ─── test setup ──────────────────────────────────────────────────────────────

describe('TradingService', () => {
  let service: TradingService;
  let positionRepo: ReturnType<typeof makePositionRepo>;
  let tradeLogRepo: ReturnType<typeof makeTradeLogRepo>;
  let exchange: ReturnType<typeof makeFakeExchange>;

  beforeEach(async () => {
    positionRepo = makePositionRepo();
    tradeLogRepo = makeTradeLogRepo();
    exchange     = makeFakeExchange();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TradingService,
        { provide: getRepositoryToken(PositionEntity),  useValue: positionRepo },
        { provide: getRepositoryToken(TradeLogEntity),  useValue: tradeLogRepo },
        { provide: MarketDataService,                    useValue: makeMarketDataService(exchange) },
        { provide: TradingSettingsService,               useValue: makeSettingsService() },
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

    it('returns null and does not throw when positionRepo.save rejects', async () => {
      positionRepo.save.mockRejectedValue(new Error('DB error'));
      const result = await service.openLong(50_000, CDCZone.STRONG_BULL, 'sandbox', 'BTC/USDT:USDT');
      expect(result).toBeNull();
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

    it('returns null when the exchange throws', async () => {
      exchange.setLeverage.mockRejectedValue(new Error('network error'));
      const result = await service.openLong(50_000, CDCZone.STRONG_BULL, 'live', 'BTC/USDT:USDT');
      expect(result).toBeNull();
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
      const updateArg = (positionRepo.update as jest.Mock).mock.calls[0][1];
      expect(updateArg.closedPnl).toBeCloseTo(20, 5);
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
      const updateArg = (positionRepo.update as jest.Mock).mock.calls[0][1];
      expect(updateArg.closedPnl).toBeCloseTo(-10, 5);
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

    it('still updates the position and writes a trade log even after exchange error', async () => {
      exchange.createMarketSellOrder.mockRejectedValue(new Error('exchange down'));
      const pos = makeOpenPosition({ mode: 'live' });
      await service.closeLong(pos, 51_000, CDCZone.BEAR, 'SIGNAL', 'live');
      expect(positionRepo.update).not.toHaveBeenCalled();
      expect(tradeLogRepo.save).not.toHaveBeenCalled();
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

    it('skips non-long positions (short) without calling closeLong', async () => {
      const shortPos = makeOpenPosition({ side: 'short', stopLoss: 51_000, takeProfit: 48_000 });
      positionRepo.find.mockResolvedValue([shortPos]);
      await service.checkSLTP(51_500, CDCZone.STRONG_BEAR, 'sandbox', 'BTC/USDT:USDT');
      expect(positionRepo.update).not.toHaveBeenCalled();
    });
  });
});
