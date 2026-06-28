import { Controller, Get, Post, Put, Delete, Query, Param, Body, BadRequestException, UseGuards } from '@nestjs/common';
import { TradingService, TradingMode } from '../trading/trading.service';
import { StrategyService } from '../strategy/strategy.service';
import { MarketDataService } from '../market-data/market-data.service';
import { CdcActionZoneService } from '../indicators/cdc-action-zone.service';
import { TradingSettingsService } from '../trading-settings/trading-settings.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

@UseGuards(JwtAuthGuard)
@Controller('api')
export class DashboardController {
  constructor(
    private tradingService: TradingService,
    private strategyService: StrategyService,
    private marketDataService: MarketDataService,
    private cdcService: CdcActionZoneService,
    private settingsService: TradingSettingsService,
  ) {}

  /** สถานะ bot — returns pairs array + aggregate fields for backward compat */
  @Get('status')
  async getStatus(@Query('mode') mode: TradingMode = 'live') {
    const allSettings = await this.settingsService.getAllSettings(mode);

    const pairs = await Promise.all(allSettings.map(async s => {
      // Sync positions first to ensure accuracy
      await this.tradingService.syncPositions(mode, s.symbol);

      const positions = await this.tradingService.getOpenPositions(mode, s.symbol);
      const pnl       = await this.tradingService.getTotalPnl(mode, s.symbol);
      const lastCdc   = this.strategyService.getLastResult(mode, s.symbol);
      return {
        symbol:    s.symbol,
        timeframe: s.timeframe,
        botStatus: s.status,
        openPositions: positions.map(p => ({
          id:         p.id,
          symbol:     p.symbol,
          side:       p.side,
          entryPrice: p.entryPrice,
          quantity:   p.quantity,
          stopLoss:   p.stopLoss,
          takeProfit: p.takeProfit,
          openTime:   p.openTime,
        })),
        lastCDC: lastCdc ? {
          zone:      lastCdc.zone,
          zoneName:  lastCdc.zoneName,
          zoneColor: lastCdc.zoneColor,
          signal:    lastCdc.signal,
          emaFast:   lastCdc.emaFast.toFixed(4),
          emaSlow:   lastCdc.emaSlow.toFixed(4),
          close:     lastCdc.close,
        } : null,
        totalPnl: pnl.toFixed(2),
      };
    }));

    const first = pairs[0];
    const aggPositions = pairs.flatMap(p => p.openPositions);
    const aggPnl = pairs.reduce((sum, p) => sum + parseFloat(p.totalPnl), 0);

    let balance = { total: 0, free: 0, used: 0 };
    try {
      balance = await this.marketDataService.fetchBalance(mode);
    } catch { /* exchange not configured or unreachable — leave zeros */ }

    return {
      status:      'running',
      mode,
      pairs,
      balance,
      // Backward-compat aggregate fields (first pair or aggregate)
      symbol:        first?.symbol ?? '',
      timeframe:     first?.timeframe ?? '',
      openPositions: aggPositions,
      lastCDC:       first?.lastCDC ?? null,
      totalPnl:      aggPnl.toFixed(2),
      timestamp:     new Date().toISOString(),
    };
  }

  /** ประวัติ trade ทั้งหมด */
  @Get('trades')
  async getTrades(
    @Query('mode') mode: TradingMode = 'live',
    @Query('symbol') symbol?: string,
  ) {
    const trades   = await this.tradingService.getTradeHistory(mode, symbol);
    const totalPnl = await this.tradingService.getTotalPnl(mode, symbol);
    return {
      trades,
      total: trades.length,
      pnl:   totalPnl.toFixed(2),
    };
  }

  /** CDC indicator สำหรับ candle ล่าสุด (on-demand) */
  @Get('indicator')
  async getIndicator(@Query('symbol') symbol = 'BTC/USDT:USDT') {
    const candles = await this.marketDataService.fetchOHLCV(200, symbol);
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
  async getCandles(
    @Query('timeframe') timeframe?: string,
    @Query('symbol') symbol = 'BTC/USDT:USDT',
  ) {
    const candles = await this.marketDataService.fetchOHLCVByTimeframe(200, timeframe, symbol);
    if (!candles.length) return { candles: [], indicators: [], count: 0 };
    const indicators = this.cdcService.calculateHistory(candles);
    return { candles, indicators, count: candles.length };
  }

  /** Health check */
  @Get('health')
  health() {
    return { status: 'ok', uptime: process.uptime(), timestamp: new Date().toISOString() };
  }

  /** Trading settings — all modes grouped */
  @Get('settings')
  getSettings() {
    return this.settingsService.getAllGrouped();
  }

  /** Trading settings — all pairs for a mode */
  @Get('settings/:mode')
  getSettingsByMode(@Param('mode') mode: TradingMode) {
    return this.settingsService.getAllSettings(mode);
  }

  /** Add a new trading pair to a mode */
  @Post('settings/:mode/pairs')
  async addPair(
    @Param('mode') mode: TradingMode,
    @Body() body: { symbol: string },
  ) {
    if (!body.symbol) throw new BadRequestException('symbol required');
    const pair = await this.settingsService.addPair(mode, body.symbol);
    await this.strategyService.addPairJob(mode, body.symbol);
    return pair;
  }

  /** Remove a trading pair from a mode */
  @Delete('settings/:mode/pairs')
  async removePair(
    @Param('mode') mode: TradingMode,
    @Query('symbol') symbol: string,
  ) {
    if (!symbol) throw new BadRequestException('symbol query param required');
    await this.tradingService.closeAllPositions(mode, symbol);
    this.strategyService.removePairJob(mode, symbol);
    await this.settingsService.removePair(mode, symbol);
    return { ok: true };
  }

  /** Update trading settings for a (mode, symbol) pair */
  @Put('settings/:mode')
  async updateSettings(
    @Param('mode') mode: TradingMode,
    @Body() body: Record<string, unknown>,
  ) {
    const symbol = body.symbol as string;
    if (!symbol) throw new BadRequestException('symbol required in body');

    const { symbol: _sym, ...fields } = body;

    if (fields.status === 'off') {
      const prev = await this.settingsService.getSettings(mode, symbol);
      if (prev.status !== 'off') {
        await this.tradingService.closeAllPositions(mode, symbol);
      }
    }

    const updated = await this.settingsService.updateSettings(mode, symbol, fields as any);

    if ('timeframe' in fields) {
      await this.strategyService.reschedule(mode, symbol);
    }

    return updated;
  }
}
