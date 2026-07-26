import { Test, TestingModule } from '@nestjs/testing';
import { SchedulerRegistry } from '@nestjs/schedule';
import { StrategyService } from './strategy.service';
import { MarketDataService } from '../market-data/market-data.service';
import { CdcActionZoneService } from '../indicators/cdc-action-zone.service';
import { TradingService } from '../trading/trading.service';
import { NotificationService } from '../notification/notification.service';
import { TradingSettingsService } from '../trading-settings/trading-settings.service';
import { CDCZone, CDCResult } from '../../common/types';

// ─── factory helpers ─────────────────────────────────────────────────────────

function makeCdcResult(overrides: Partial<CDCResult> = {}): CDCResult {
  return {
    zone:      CDCZone.STRONG_BULL,
    emaFast:   50_000,
    emaSlow:   49_000,
    close:     51_000,
    isBullish: true,
    isBearish: false,
    signal:    'HOLD',
    zoneName:  'Strong Bull',
    zoneColor: '#00FF00',
    ...overrides,
  };
}

const mockCandles = Array.from({ length: 50 }, (_, i) => ({
  timestamp: i * 3600_000,
  open: 50_000, high: 50_000, low: 50_000, close: 50_000, volume: 1,
}));

// ─── mock factories ──────────────────────────────────────────────────────────

function makeMarketDataService(candles = mockCandles): jest.Mocked<Partial<MarketDataService>> {
  return {
    fetchOHLCV:            jest.fn().mockResolvedValue(candles),
    fetchOHLCVByTimeframe: jest.fn().mockResolvedValue(candles),
    getSymbol:             jest.fn().mockReturnValue('BTC/USDT:USDT'),
    getTimeframe:          jest.fn().mockReturnValue('1h'),
  } as any;
}

function makeCdcService(result: CDCResult | null = makeCdcResult()): jest.Mocked<Partial<CdcActionZoneService>> {
  return { calculate: jest.fn().mockReturnValue(result) } as any;
}

function makeTradingService(): jest.Mocked<Partial<TradingService>> {
  return {
    checkSLTP:        jest.fn().mockResolvedValue(undefined),
    hasOpenPosition:  jest.fn().mockResolvedValue(false),
    openLong:         jest.fn().mockResolvedValue({ id: 'pos-1', side: 'long', entryPrice: 51_000 }),
    openShort:        jest.fn().mockResolvedValue({ id: 'pos-2', side: 'short', entryPrice: 51_000 }),
    getOpenPositions: jest.fn().mockResolvedValue([]),
    closeLong:        jest.fn().mockResolvedValue(undefined),
    closeShort:       jest.fn().mockResolvedValue(undefined),
    syncPositions:    jest.fn().mockResolvedValue(undefined),
  } as any;
}

function makeNotificationService(): jest.Mocked<Partial<NotificationService>> {
  return {
    sendSignal:        jest.fn().mockResolvedValue(undefined),
    sendOpenPosition:  jest.fn().mockResolvedValue(undefined),
    sendClosePosition: jest.fn().mockResolvedValue(undefined),
    sendError:         jest.fn().mockResolvedValue(undefined),
  } as any;
}

function makeSettingsService(): jest.Mocked<Partial<TradingSettingsService>> {
  const defaults = { symbol: 'BTC/USDT:USDT', timeframe: '1h', emaFast: 12, emaSlow: 26, status: 'on', mode: 'live' };
  return {
    getSettings:   jest.fn().mockResolvedValue(defaults),
    getAllSettings: jest.fn().mockImplementation((mode) => Promise.resolve([{ ...defaults, mode }])),
    seedIfEmpty:   jest.fn().mockImplementation((mode) => Promise.resolve([{ ...defaults, mode }])),
  } as any;
}

function makeSchedulerRegistry(): jest.Mocked<Partial<SchedulerRegistry>> {
  return {
    doesExist:     jest.fn().mockReturnValue(false),
    deleteCronJob: jest.fn(),
    addCronJob:    jest.fn(),
  } as any;
}

// ─── test suite ──────────────────────────────────────────────────────────────

describe('StrategyService', () => {
  let service: StrategyService;
  let marketDataSvc: ReturnType<typeof makeMarketDataService>;
  let cdcSvc: ReturnType<typeof makeCdcService>;
  let tradingSvc: ReturnType<typeof makeTradingService>;
  let notificationSvc: ReturnType<typeof makeNotificationService>;

  async function buildModule(
    cdcResult: CDCResult | null = makeCdcResult(),
    candles = mockCandles,
  ) {
    marketDataSvc   = makeMarketDataService(candles);
    cdcSvc          = makeCdcService(cdcResult);
    tradingSvc      = makeTradingService();
    notificationSvc = makeNotificationService();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        StrategyService,
        { provide: MarketDataService,      useValue: marketDataSvc },
        { provide: CdcActionZoneService,   useValue: cdcSvc },
        { provide: TradingService,         useValue: tradingSvc },
        { provide: NotificationService,    useValue: notificationSvc },
        { provide: TradingSettingsService, useValue: makeSettingsService() },
        { provide: SchedulerRegistry,      useValue: makeSchedulerRegistry() },
      ],
    }).compile();

    service = module.get<StrategyService>(StrategyService);
  }

  // ── runStrategy() — data guard ────────────────────────────────────────────

  describe('runStrategy()', () => {
    it('does nothing and returns early when fetchOHLCVByTimeframe returns an empty array', async () => {
      await buildModule(makeCdcResult(), []);
      await service.runStrategy();
      expect(cdcSvc.calculate).not.toHaveBeenCalled();
    });

    it('excludes the still-forming (unclosed) candle before calculating the signal', async () => {
      const closed = mockCandles.slice(0, 49);
      const forming = { timestamp: Date.now(), open: 50_000, high: 50_000, low: 50_000, close: 50_000, volume: 1 };
      await buildModule(makeCdcResult(), [...closed, forming]);
      await service.runStrategy();
      // The lastZone-reconstruction call passes lastZone=undefined; the main
      // signal call passes the reconstructed zone — assert on the main call.
      const mainCalls = (cdcSvc.calculate as jest.Mock).mock.calls.filter(c => c[1] !== undefined);
      expect(mainCalls[0][0]).toEqual(closed);
    });

    it('does nothing when cdcService.calculate() returns null', async () => {
      await buildModule(null);
      await service.runStrategy();
      expect(tradingSvc.checkSLTP).not.toHaveBeenCalled();
    });

    it('does not call checkSLTP — SL/TP is enforced by native exchange orders', async () => {
      const result = makeCdcResult({ signal: 'HOLD', close: 51_000 });
      await buildModule(result);
      await service.runStrategy();
      expect(tradingSvc.checkSLTP).not.toHaveBeenCalled();
    });

    // ── BUY path ────────────────────────────────────────────────────────────

    it('calls openLong for both modes when signal is BUY and no open position exists', async () => {
      const result = makeCdcResult({ signal: 'BUY', isBullish: true, isBearish: false });
      await buildModule(result);
      await service.runStrategy();
      expect(tradingSvc.openLong).toHaveBeenCalledWith(result.close, result.zone, 'live', 'BTC/USDT:USDT');
      expect(tradingSvc.openLong).toHaveBeenCalledWith(result.close, result.zone, 'sandbox', 'BTC/USDT:USDT');
    });

    it('sends a BUY notification for both modes when signal is BUY', async () => {
      const result = makeCdcResult({ signal: 'BUY', isBullish: true, isBearish: false });
      await buildModule(result);
      await service.runStrategy();
      const buyNotifyCalls = (notificationSvc.sendSignal as jest.Mock).mock.calls.filter(
        (args) => args[0] === 'BUY',
      );
      expect(buyNotifyCalls).toHaveLength(2);
      expect(buyNotifyCalls.map((args) => args[3]).sort()).toEqual(['live', 'sandbox']);
    });

    it('sends the BUY notification once per mode across repeated runs of the same transition', async () => {
      const result = makeCdcResult({ signal: 'BUY', isBullish: true, isBearish: false });
      await buildModule(result);
      await service.runStrategy();
      await service.runStrategy();
      const buyNotifies = (notificationSvc.sendSignal as jest.Mock).mock.calls.filter(
        (args) => args[0] === 'BUY',
      );
      // one per mode — NOT doubled by the second run
      expect(buyNotifies).toHaveLength(2);
    });

    it('still calls openLong on BUY — maxPositions is enforced inside TradingService', async () => {
      const result = makeCdcResult({ signal: 'BUY', isBullish: true, isBearish: false });
      await buildModule(result);
      (tradingSvc.openLong as jest.Mock).mockResolvedValue(null); // limit reached
      await service.runStrategy();
      expect(tradingSvc.openLong).toHaveBeenCalled();
      expect(notificationSvc.sendOpenPosition).not.toHaveBeenCalled();
    });

    // ── SELL path ────────────────────────────────────────────────────────────

    it('calls closeLong for each open long position when signal is SELL', async () => {
      const openPos = { id: 'pos-1', side: 'long', entryPrice: 50_000, quantity: 0.01 };
      const result = makeCdcResult({
        signal:    'SELL',
        isBullish: false,
        isBearish: true,
        zone:      CDCZone.STRONG_BEAR,
      });
      await buildModule(result);
      (tradingSvc.getOpenPositions as jest.Mock).mockResolvedValue([openPos]);
      await service.runStrategy();
      expect(tradingSvc.closeLong).toHaveBeenCalledWith(
        openPos, result.close, result.zone, 'SIGNAL', 'live',
      );
    });

    it('sends a SELL notification for both modes when signal is SELL', async () => {
      const result = makeCdcResult({
        signal: 'SELL', isBullish: false, isBearish: true, zone: CDCZone.STRONG_BEAR,
      });
      await buildModule(result);
      await service.runStrategy();
      const sellCalls = (notificationSvc.sendSignal as jest.Mock).mock.calls.filter(
        (args) => args[0] === 'SELL',
      );
      expect(sellCalls).toHaveLength(2);
    });

    it('does not call closeLong when there are no open positions on SELL signal', async () => {
      const result = makeCdcResult({
        signal: 'SELL', isBullish: false, isBearish: true, zone: CDCZone.STRONG_BEAR,
      });
      await buildModule(result);
      (tradingSvc.getOpenPositions as jest.Mock).mockResolvedValue([]);
      await service.runStrategy();
      expect(tradingSvc.closeLong).not.toHaveBeenCalled();
    });

    // ── HOLD path ────────────────────────────────────────────────────────────

    it('does not call openLong or closeLong when signal is HOLD', async () => {
      const result = makeCdcResult({ signal: 'HOLD' });
      await buildModule(result);
      await service.runStrategy();
      expect(tradingSvc.openLong).not.toHaveBeenCalled();
      expect(tradingSvc.closeLong).not.toHaveBeenCalled();
    });

    // ── Error handling ───────────────────────────────────────────────────────

    it('sends an error notification for both modes when runForMode throws', async () => {
      const result = makeCdcResult({ signal: 'BUY' });
      await buildModule(result);
      (tradingSvc.openLong as jest.Mock).mockRejectedValue(new Error('exchange error'));
      await service.runStrategy();
      expect(notificationSvc.sendError).toHaveBeenCalledWith('exchange error', 'live');
      expect(notificationSvc.sendError).toHaveBeenCalledWith('exchange error', 'sandbox');
    });

    it('resets isRunning flag even when an error occurs (finally block)', async () => {
      const result = makeCdcResult({ signal: 'BUY' });
      await buildModule(result);
      (tradingSvc.openLong as jest.Mock).mockRejectedValue(new Error('oops'));
      await service.runStrategy();
      // Second call must not be blocked by isRunning=true
      await service.runStrategy();
      // 1st run: 2 modes × (lastZone reconstruction + signal) = 4
      // 2nd run: lastZone already known → 2 modes × 1 = 2
      expect(cdcSvc.calculate).toHaveBeenCalledTimes(6);
    });
  });

  // ── getLastResult() ──────────────────────────────────────────────────────

  describe('getLastResult()', () => {
    it('returns null before any strategy run', async () => {
      await buildModule();
      expect(service.getLastResult('live', 'BTC/USDT:USDT')).toBeNull();
      expect(service.getLastResult('sandbox', 'BTC/USDT:USDT')).toBeNull();
    });

    it('returns the last CDCResult after a successful strategy run', async () => {
      const result = makeCdcResult({ signal: 'HOLD', zone: CDCZone.BULL });
      await buildModule(result);
      await service.runStrategy();
      expect(service.getLastResult('live', 'BTC/USDT:USDT')).toEqual(result);
      expect(service.getLastResult('sandbox', 'BTC/USDT:USDT')).toEqual(result);
    });

    it('defaults mode to "live" when no argument is passed', async () => {
      const result = makeCdcResult({ signal: 'HOLD' });
      await buildModule(result);
      await service.runStrategy();
      expect(service.getLastResult('live', 'BTC/USDT:USDT')).toEqual(result);
    });
  });
});
