import { Controller, Get, Put, Query, Param, Body } from '@nestjs/common';
import { TradingService, TradingMode } from '../trading/trading.service';
import { StrategyService } from '../strategy/strategy.service';
import { MarketDataService } from '../market-data/market-data.service';
import { CdcActionZoneService } from '../indicators/cdc-action-zone.service';
import { TradingSettingsService } from '../trading-settings/trading-settings.service';

@Controller('api')
export class DashboardController {
  constructor(
    private tradingService: TradingService,
    private strategyService: StrategyService,
    private marketDataService: MarketDataService,
    private cdcService: CdcActionZoneService,
    private settingsService: TradingSettingsService,
  ) {}

  /** สถานะ bot และ position ปัจจุบัน */
  @Get('status')
  async getStatus(@Query('mode') mode: TradingMode = 'live') {
    const positions = await this.tradingService.getOpenPositions(mode);
    const totalPnl  = await this.tradingService.getTotalPnl(mode);
    const lastCdc   = this.strategyService.getLastResult(mode);
    return {
      status:      'running',
      mode,
      symbol:      this.marketDataService.getSymbol(),
      timeframe:   this.marketDataService.getTimeframe(),
      openPositions: positions.map((p) => ({
        id:         p.id,
        side:       p.side,
        entryPrice: p.entryPrice,
        quantity:   p.quantity,
        stopLoss:   p.stopLoss,
        takeProfit: p.takeProfit,
        openTime:   p.openTime,
      })),
      lastCDC: lastCdc
        ? {
            zone:      lastCdc.zone,
            zoneName:  lastCdc.zoneName,
            zoneColor: lastCdc.zoneColor,
            signal:    lastCdc.signal,
            emaFast:   lastCdc.emaFast.toFixed(4),
            emaSlow:   lastCdc.emaSlow.toFixed(4),
            close:     lastCdc.close,
          }
        : null,
      totalPnl:  totalPnl.toFixed(2),
      timestamp: new Date().toISOString(),
    };
  }

  /** ประวัติ trade ทั้งหมด */
  @Get('trades')
  async getTrades(@Query('mode') mode: TradingMode = 'live') {
    const trades   = await this.tradingService.getTradeHistory(mode);
    const totalPnl = await this.tradingService.getTotalPnl(mode);
    return {
      trades,
      total: trades.length,
      pnl:   totalPnl.toFixed(2),
    };
  }

  /** CDC indicator สำหรับ candle ล่าสุด (on-demand) */
  @Get('indicator')
  async getIndicator() {
    const candles = await this.marketDataService.fetchOHLCV(200);
    if (!candles.length) return { error: 'ไม่ได้รับ candle data' };

    const result = this.cdcService.calculate(candles);
    if (!result) return { error: 'คำนวณ indicator ไม่ได้' };

    return {
      zone:      result.zone,
      zoneName:  result.zoneName,
      zoneColor: result.zoneColor,
      signal:    result.signal,
      emaFast:   result.emaFast,
      emaSlow:   result.emaSlow,
      close:     result.close,
      isBullish: result.isBullish,
      isBearish: result.isBearish,
    };
  }

  /** OHLCV candles + CDC indicators สำหรับ chart */
  @Get('candles')
  async getCandles(@Query('timeframe') timeframe?: string) {
    const candles = await this.marketDataService.fetchOHLCVByTimeframe(200, timeframe);
    if (!candles.length) return { candles: [], indicators: [], count: 0 };
    const indicators = this.cdcService.calculateHistory(candles);
    return { candles, indicators, count: candles.length };
  }

  /** Health check */
  @Get('health')
  health() {
    return { status: 'ok', uptime: process.uptime(), timestamp: new Date().toISOString() };
  }

  /** Trading settings — all modes */
  @Get('settings')
  getSettings() {
    return this.settingsService.getAllSettings();
  }

  /** Trading settings — single mode */
  @Get('settings/:mode')
  getSettingsByMode(@Param('mode') mode: TradingMode) {
    return this.settingsService.getSettings(mode);
  }

  /** Update trading settings for a mode — reschedules cron if timeframe changed; closes positions if status→off */
  @Put('settings/:mode')
  async updateSettings(@Param('mode') mode: TradingMode, @Body() body: Record<string, unknown>) {
    if (body.status === 'off') {
      const prev = await this.settingsService.getSettings(mode);
      if (prev.status !== 'off') {
        await this.tradingService.closeAllPositions(mode);
      }
    }
    const updated = await this.settingsService.updateSettings(mode, body as any);
    if ('timeframe' in body) {
      await this.strategyService.reschedule(mode);
    }
    return updated;
  }
}
