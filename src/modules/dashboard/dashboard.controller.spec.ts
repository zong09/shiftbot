import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { DashboardController } from './dashboard.controller';
import { TradingService } from '../trading/trading.service';
import { StrategyService } from '../strategy/strategy.service';
import { MarketDataService, MAX_CANDLES } from '../market-data/market-data.service';
import { CdcActionZoneService } from '../indicators/cdc-action-zone.service';
import { TradingSettingsService } from '../trading-settings/trading-settings.service';
import { NotificationSettingsService } from '../notification-settings/notification-settings.service';
import { NotificationService } from '../notification/notification.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CDCZone, CDCResult, Position, TradeLog } from '../../common/types';

// ─── fixture helpers ─────────────────────────────────────────────────────────

function makeCdcResult(overrides: Partial<CDCResult> = {}): CDCResult {
  return {
    zone:      CDCZone.STRONG_BULL,
    emaFast:   50_000.1234,
    emaSlow:   49_000.5678,
    close:     51_000,
    isBullish: true,
    isBearish: false,
    signal:    'HOLD',
    zoneName:  'Strong Bull',
    zoneColor: '#00FF00',
    ...overrides,
  };
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
    openTime:    new Date('2024-01-01T00:00:00.000Z'),
    status:      'open',
    mode:        'live',
    ...overrides,
  } as Position;
}

function makeTradeLog(overrides: Partial<TradeLog> = {}): TradeLog {
  return {
    id:        'log-1',
    timestamp: new Date('2024-01-01T00:00:00.000Z'),
    symbol:    'BTC/USDT:USDT',
    action:    'OPEN_LONG',
    price:     50_000,
    quantity:  0.01,
    zone:      CDCZone.STRONG_BULL,
    signal:    'BUY',
    mode:      'live',
    ...overrides,
  } as TradeLog;
}

// ─── service mocks ───────────────────────────────────────────────────────────

function makeTradingService(): jest.Mocked<Partial<TradingService>> {
  return {
    getOpenPositions:  jest.fn().mockResolvedValue([]),
    getTotalPnl:       jest.fn().mockResolvedValue(0),
    getTradeHistory:   jest.fn().mockResolvedValue([]),
    syncPositions:     jest.fn().mockResolvedValue(undefined),
    validateOrderSize: jest.fn().mockResolvedValue(undefined),
    openLong:          jest.fn().mockResolvedValue(makeOpenPosition()),
    openShort:         jest.fn().mockResolvedValue(makeOpenPosition({ side: 'short' })),
  } as any;
}

function makeStrategyService(): jest.Mocked<Partial<StrategyService>> {
  return {
    getLastResult: jest.fn().mockReturnValue(null),
  } as any;
}

function makeMarketDataService(): jest.Mocked<Partial<MarketDataService>> {
  return {
    fetchOHLCV:   jest.fn().mockResolvedValue([]),
    fetchBalance: jest.fn().mockResolvedValue({ total: 0, free: 0, used: 0 }),
    fetchTicker:  jest.fn().mockResolvedValue({ bid: 49_999, ask: 50_001, last: 50_000 }),
    fetchOHLCVByTimeframe: jest.fn().mockResolvedValue([]),
  } as any;
}

function makeCdcService(): jest.Mocked<Partial<CdcActionZoneService>> {
  return {
    calculate: jest.fn().mockReturnValue(null),
  } as any;
}

function makeNotificationSettingsService(): jest.Mocked<Partial<NotificationSettingsService>> {
  return {
    getMaskedSettings: jest.fn().mockResolvedValue({
      mode: 'live', lineEnabled: false, lineWebhookUrl: null, lineChannelAccessToken: null,
      lineChannelSecret: null, lineGroupId: null, lineUserId: null,
      notifyOpen: true, notifyClose: true, notifyTpSl: true, notifyError: true,
      notifyDailySummary: false, lastSentAt: null,
      telegramEnabled: false, telegramBotToken: null, telegramChatId: null,
      telegramMessageThreadId: null, telegramNotifyOpen: true, telegramNotifyClose: true,
      telegramNotifyTpSl: true, telegramNotifyError: true, telegramNotifyDailySummary: false,
      telegramLastSentAt: null,
    }),
    updateSettings: jest.fn().mockResolvedValue({}),
    markSent: jest.fn().mockResolvedValue({}),
  } as any;
}

function makeNotificationService(): jest.Mocked<Partial<NotificationService>> {
  return {
    sendTest: jest.fn().mockResolvedValue(true),
  } as any;
}

// ─── test suite ──────────────────────────────────────────────────────────────

describe('DashboardController', () => {
  let controller: DashboardController;
  let tradingSvc: ReturnType<typeof makeTradingService>;
  let strategySvc: ReturnType<typeof makeStrategyService>;
  let marketDataSvc: ReturnType<typeof makeMarketDataService>;
  let cdcSvc: ReturnType<typeof makeCdcService>;
  let notificationSettingsSvc: ReturnType<typeof makeNotificationSettingsService>;
  let notificationSvc: ReturnType<typeof makeNotificationService>;
  let settingsSvc: any;

  beforeEach(async () => {
    tradingSvc    = makeTradingService();
    strategySvc   = makeStrategyService();
    marketDataSvc = makeMarketDataService();
    cdcSvc        = makeCdcService();
    notificationSettingsSvc = makeNotificationSettingsService();
    notificationSvc = makeNotificationService();
    settingsSvc = {
      getSettings:    jest.fn().mockResolvedValue({ status: 'on' }),
      getAllSettings: jest.fn().mockResolvedValue([{ symbol: 'BTC/USDT:USDT', timeframe: '1h', status: 'on' }]),
      updateSettings: jest.fn().mockResolvedValue({}),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [DashboardController],
      providers: [
        { provide: TradingService,        useValue: tradingSvc },
        { provide: StrategyService,       useValue: strategySvc },
        { provide: MarketDataService,     useValue: marketDataSvc },
        { provide: CdcActionZoneService,  useValue: cdcSvc },
        { provide: TradingSettingsService, useValue: settingsSvc },
        { provide: NotificationSettingsService, useValue: notificationSettingsSvc },
        { provide: NotificationService,         useValue: notificationSvc },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get<DashboardController>(DashboardController);
  });

  // ── GET /api/status ──────────────────────────────────────────────────────

  describe('GET /api/status', () => {
    it('returns status="running" with the requested mode', async () => {
      const response = await controller.getStatus('live');
      expect(response.status).toBe('running');
      expect(response.mode).toBe('live');
    });

    it('defaults mode to "live" when no query param is supplied', async () => {
      const response = await controller.getStatus(undefined as any);
      expect(response.mode).toBe('live');
    });

    it('returns symbol and timeframe from first pair settings', async () => {
      const response = await controller.getStatus('live');
      expect(response.symbol).toBe('BTC/USDT:USDT');
      expect(response.timeframe).toBe('1h');
    });

    it('returns an empty openPositions array when no positions are open', async () => {
      const response = await controller.getStatus('live');
      expect(response.openPositions).toEqual([]);
    });

    it('maps open positions to the correct shape (id, side, entryPrice, quantity, stopLoss, takeProfit, openTime)', async () => {
      const pos = makeOpenPosition();
      (tradingSvc.getOpenPositions as jest.Mock).mockResolvedValue([pos]);
      const response = await controller.getStatus('live');
      expect(response.openPositions).toHaveLength(1);
      const mapped = response.openPositions[0];
      expect(mapped).toHaveProperty('id', 'pos-1');
      expect(mapped).toHaveProperty('side', 'long');
      expect(mapped).toHaveProperty('entryPrice', 50_000);
      expect(mapped).toHaveProperty('quantity', 0.01);
      expect(mapped).toHaveProperty('stopLoss', 49_000);
      expect(mapped).toHaveProperty('takeProfit', 52_000);
      expect(mapped).toHaveProperty('openTime');
      expect(Object.keys(mapped)).not.toContain('status');
    });

    it('returns lastCDC=null when StrategyService has no result yet', async () => {
      (strategySvc.getLastResult as jest.Mock).mockReturnValue(null);
      const response = await controller.getStatus('live');
      expect(response.lastCDC).toBeNull();
    });

    it('maps lastCDC fields correctly and formats emaFast / emaSlow to 4 decimal places', async () => {
      const emaFast = 50_000.12345;
      const emaSlow = 49_000.6789;
      const cdcResult = makeCdcResult({ emaFast, emaSlow });
      (strategySvc.getLastResult as jest.Mock).mockReturnValue(cdcResult);
      const response = await controller.getStatus('live');
      expect(response.lastCDC).not.toBeNull();
      expect(response.lastCDC.zone).toBe(CDCZone.STRONG_BULL);
      expect(response.lastCDC.zoneName).toBe('Strong Bull');
      expect(response.lastCDC.zoneColor).toBe('#00FF00');
      expect(response.lastCDC.signal).toBe('HOLD');
      expect(response.lastCDC.emaFast).toBe(emaFast.toFixed(4));
      expect(response.lastCDC.emaSlow).toBe(emaSlow.toFixed(4));
      expect(response.lastCDC.close).toBe(51_000);
    });

    it('returns totalPnl as a string with 2 decimal places', async () => {
      (tradingSvc.getTotalPnl as jest.Mock).mockResolvedValue(123.456);
      const response = await controller.getStatus('live');
      expect(response.totalPnl).toBe('123.46');
    });

    it('includes a timestamp in ISO 8601 format', async () => {
      const response = await controller.getStatus('live');
      expect(response.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
    });

    it('passes the mode to tradingService.getOpenPositions', async () => {
      await controller.getStatus('sandbox');
      expect(tradingSvc.getOpenPositions).toHaveBeenCalledWith('sandbox', 'BTC/USDT:USDT');
    });

    it('passes the mode to tradingService.getTotalPnl', async () => {
      await controller.getStatus('sandbox');
      expect(tradingSvc.getTotalPnl).toHaveBeenCalledWith('sandbox', 'BTC/USDT:USDT');
    });
  });

  // ── GET /api/trades ──────────────────────────────────────────────────────

  describe('GET /api/trades', () => {
    it('returns trades array, total count, and pnl', async () => {
      const response = await controller.getTrades('live');
      expect(response).toHaveProperty('trades');
      expect(response).toHaveProperty('total');
      expect(response).toHaveProperty('pnl');
    });

    it('returns an empty trades array and total=0 when there are no logs', async () => {
      const response = await controller.getTrades('live');
      expect(response.trades).toEqual([]);
      expect(response.total).toBe(0);
    });

    it('returns the correct trade count when logs exist', async () => {
      const logs = [makeTradeLog(), makeTradeLog({ id: 'log-2' })];
      (tradingSvc.getTradeHistory as jest.Mock).mockResolvedValue(logs);
      const response = await controller.getTrades('live');
      expect(response.total).toBe(2);
      expect(response.trades).toHaveLength(2);
    });

    it('formats pnl as a string with 2 decimal places', async () => {
      (tradingSvc.getTotalPnl as jest.Mock).mockResolvedValue(99.999);
      const response = await controller.getTrades('live');
      expect(response.pnl).toBe('100.00');
    });

    it('passes the mode to both getTradeHistory and getTotalPnl', async () => {
      await controller.getTrades('sandbox');
      expect(tradingSvc.getTradeHistory).toHaveBeenCalledWith('sandbox', undefined);
      expect(tradingSvc.getTotalPnl).toHaveBeenCalledWith('sandbox', undefined);
    });

    it('defaults mode to "live" when no query param is provided', async () => {
      await controller.getTrades(undefined as any);
      expect(tradingSvc.getTradeHistory).toHaveBeenCalledWith('live', undefined);
    });
  });

  // ── GET /api/indicator ───────────────────────────────────────────────────

  describe('GET /api/indicator', () => {
    it('returns an error object when fetchOHLCV returns an empty array', async () => {
      (marketDataSvc.fetchOHLCV as jest.Mock).mockResolvedValue([]);
      const response = await controller.getIndicator();
      expect(response).toHaveProperty('error');
    });

    it('returns an error object when cdcService.calculate returns null', async () => {
      const candles = Array.from({ length: 50 }, (_, i) => ({
        timestamp: i * 3600_000, open: 100, high: 100, low: 100, close: 100, volume: 1,
      }));
      (marketDataSvc.fetchOHLCV as jest.Mock).mockResolvedValue(candles);
      (cdcSvc.calculate as jest.Mock).mockReturnValue(null);
      const response = await controller.getIndicator();
      expect(response).toHaveProperty('error');
    });

    it('returns a correctly shaped indicator object on success', async () => {
      const candles = Array.from({ length: 50 }, (_, i) => ({
        timestamp: i * 3600_000, open: 100, high: 100, low: 100, close: 100, volume: 1,
      }));
      const result = makeCdcResult();
      (marketDataSvc.fetchOHLCV as jest.Mock).mockResolvedValue(candles);
      (cdcSvc.calculate as jest.Mock).mockReturnValue(result);
      const response = await controller.getIndicator();
      expect(response).toMatchObject({
        zone:      result.zone,
        zoneName:  result.zoneName,
        zoneColor: result.zoneColor,
        signal:    result.signal,
        emaFast:   result.emaFast,
        emaSlow:   result.emaSlow,
        close:     result.close,
        isBullish: result.isBullish,
        isBearish: result.isBearish,
      });
    });

    it('calls cdcService.calculate with the fetched candles', async () => {
      const candles = [{ timestamp: 1, open: 1, high: 1, low: 1, close: 1, volume: 1 }];
      (marketDataSvc.fetchOHLCV as jest.Mock).mockResolvedValue(candles);
      await controller.getIndicator();
      expect(cdcSvc.calculate).toHaveBeenCalledWith(candles);
    });

    // MAX_CANDLES is what the chart pans over, and the cache is shared with the
    // strategy — every caller asks for the same window, hence the constant.
    it('fetches MAX_CANDLES candles from MarketDataService', async () => {
      await controller.getIndicator();
      expect(marketDataSvc.fetchOHLCV).toHaveBeenCalledWith(MAX_CANDLES, 'BTC/USDT:USDT');
    });
  });

  // ── GET /api/health ──────────────────────────────────────────────────────

  describe('GET /api/health', () => {
    it('returns status="ok"', () => {
      const response = controller.health();
      expect(response.status).toBe('ok');
    });

    it('includes uptime as a number', () => {
      const response = controller.health();
      expect(typeof response.uptime).toBe('number');
      expect(response.uptime).toBeGreaterThanOrEqual(0);
    });

    it('includes a timestamp in ISO 8601 format', () => {
      const response = controller.health();
      expect(response.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
    });

    it('is synchronous and never returns a Promise', () => {
      const response = controller.health();
      expect(response).not.toBeInstanceOf(Promise);
    });
  });

  // ── Notification settings ────────────────────────────────────────────────

  describe('GET /api/settings/notifications/:mode', () => {
    it('returns masked settings for the requested mode', async () => {
      const response = await controller.getNotificationSettings('live');
      expect(notificationSettingsSvc.getMaskedSettings).toHaveBeenCalledWith('live');
      expect(response).toHaveProperty('lineChannelAccessToken', null);
    });
  });

  describe('PUT /api/settings/notifications/:mode', () => {
    it('delegates to notificationSettingsService.updateSettings', async () => {
      const body = { lineEnabled: true, telegramEnabled: true, lineWebhookUrl: 'https://api.line.me/v2/bot/message/push' };
      await controller.updateNotificationSettings('sandbox', body as any);
      expect(notificationSettingsSvc.updateSettings).toHaveBeenCalledWith('sandbox', body);
    });
  });

  describe('POST /api/settings/notifications/:mode/test', () => {
    it('sends a test notification on the requested channel then marks that channel sent', async () => {
      await controller.sendTestNotification('live', 'telegram');
      expect(notificationSvc.sendTest).toHaveBeenCalledWith('live', 'telegram');
      expect(notificationSettingsSvc.markSent).toHaveBeenCalledWith('live', 'telegram');
    });

    // Otherwise the dashboard's "last sent" line would claim a send that never happened.
    it('400s and does NOT mark sent when the channel has no usable config', async () => {
      (notificationSvc.sendTest as jest.Mock).mockResolvedValueOnce(false);
      await expect(controller.sendTestNotification('live', 'telegram')).rejects.toThrow(BadRequestException);
      expect(notificationSettingsSvc.markSent).not.toHaveBeenCalled();
    });
  });

  // ── POST /api/positions/manual ────────────────────────────────────────────

  describe('POST /api/positions/manual', () => {
    const body = {
      mode: 'live' as const,
      symbol: 'BTC/USDT:USDT',
      side: 'long' as const,
      orderSizeUsdt: 12,
      leverage: 5,
    };

    it('opens a long with the requested size/leverage, not the pair settings values', async () => {
      const response = await controller.openManualPosition({ ...body });

      expect(tradingSvc.openLong).toHaveBeenCalledWith(
        50_000, expect.anything(), 'live', 'BTC/USDT:USDT',
        { orderSizeUsdt: 12, leverage: 5, signal: 'MANUAL' },
      );
      expect(tradingSvc.openShort).not.toHaveBeenCalled();
      expect(response.ok).toBe(true);
    });

    it('opens a short when side is short', async () => {
      await controller.openManualPosition({ ...body, side: 'short' });
      expect(tradingSvc.openShort).toHaveBeenCalled();
      expect(tradingSvc.openLong).not.toHaveBeenCalled();
    });

    // The entry price is the exchange's, never the client's — the DTO has no price field,
    // so this proves the handler sources it from the ticker.
    it('uses the live ticker price as the entry price', async () => {
      (marketDataSvc.fetchTicker as jest.Mock).mockResolvedValueOnce({ bid: 1, ask: 3, last: 61_234.5 });
      await controller.openManualPosition({ ...body });
      expect(tradingSvc.openLong).toHaveBeenCalledWith(
        61_234.5, expect.anything(), 'live', 'BTC/USDT:USDT', expect.anything(),
      );
    });

    // getSettings() upserts on a miss, so an unknown symbol must be rejected before
    // it is ever called — otherwise a phantom settings row appears with no cron job.
    it('404s for a symbol that is not a configured pair, without submitting an order', async () => {
      settingsSvc.getAllSettings.mockResolvedValueOnce([{ symbol: 'ETH/USDT:USDT' }]);

      await expect(controller.openManualPosition({ ...body })).rejects.toThrow(NotFoundException);
      expect(settingsSvc.getSettings).not.toHaveBeenCalled();
      expect(tradingSvc.openLong).not.toHaveBeenCalled();
    });

    // openLong returns null at the per-side cap without submitting anything.
    it('409s when the side is already at maxPositions', async () => {
      (tradingSvc.openLong as jest.Mock).mockResolvedValueOnce(null);
      await expect(controller.openManualPosition({ ...body })).rejects.toThrow(ConflictException);
    });

    it('propagates the min-notional BadRequest and never submits the order', async () => {
      (tradingSvc.validateOrderSize as jest.Mock).mockRejectedValueOnce(new BadRequestException('too small'));
      await expect(controller.openManualPosition({ ...body })).rejects.toThrow(BadRequestException);
      expect(tradingSvc.openLong).not.toHaveBeenCalled();
    });

    // trade_logs.zone is NOT NULL; CDCZone.NONE is the existing sentinel for "no zone".
    it('falls back to CDCZone.NONE when the indicator cannot be computed', async () => {
      (cdcSvc.calculate as jest.Mock).mockReturnValueOnce(null);
      await controller.openManualPosition({ ...body });
      expect(tradingSvc.openLong).toHaveBeenCalledWith(
        50_000, CDCZone.NONE, 'live', 'BTC/USDT:USDT', expect.anything(),
      );
    });

    it('passes the computed zone through to the trade log', async () => {
      (marketDataSvc.fetchOHLCVByTimeframe as jest.Mock).mockResolvedValueOnce([{ close: 1 }]);
      (cdcSvc.calculate as jest.Mock).mockReturnValueOnce(makeCdcResult({ zone: CDCZone.BULL }));
      await controller.openManualPosition({ ...body });
      expect(tradingSvc.openLong).toHaveBeenCalledWith(
        50_000, CDCZone.BULL, 'live', 'BTC/USDT:USDT', expect.anything(),
      );
    });

    // The logged zone is a permanent DB fact — it has to be the zone the bot's own signal
    // path would see for that pair, not a default 1h/12/26 reading.
    it('computes the zone on the pair timeframe and EMA settings', async () => {
      settingsSvc.getAllSettings.mockResolvedValueOnce([
        { symbol: 'BTC/USDT:USDT', timeframe: '4h', emaFast: 9, emaSlow: 21 },
      ]);
      const candles = [{ close: 1 }];
      (marketDataSvc.fetchOHLCVByTimeframe as jest.Mock).mockResolvedValueOnce(candles);
      await controller.openManualPosition({ ...body });
      expect(marketDataSvc.fetchOHLCVByTimeframe).toHaveBeenCalledWith(MAX_CANDLES, '4h', 'BTC/USDT:USDT');
      expect(cdcSvc.calculate).toHaveBeenCalledWith(candles, undefined, 9, 21);
    });
  });
});
