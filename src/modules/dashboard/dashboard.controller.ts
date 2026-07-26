import { Controller, Get, Post, Put, Delete, Query, Param, Body, BadRequestException, BadGatewayException, NotFoundException, DefaultValuePipe, ParseUUIDPipe, UseGuards } from '@nestjs/common';
import { TradingService, TradingMode } from '../trading/trading.service';
import { StrategyService } from '../strategy/strategy.service';
import { MarketDataService } from '../market-data/market-data.service';
import { CdcActionZoneService } from '../indicators/cdc-action-zone.service';
import { TradingSettingsService } from '../trading-settings/trading-settings.service';
import { NotificationSettingsService, NotificationMode, NotificationChannel } from '../notification-settings/notification-settings.service';
import { NotificationService } from '../notification/notification.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { UpdateSettingsDto, SYMBOL_PATTERN, VALID_TIMEFRAMES } from './dto/update-settings.dto';
import { AddPairDto } from './dto/add-pair.dto';
import { UpdateNotificationSettingsDto } from '../notification-settings/dto/update-notification-settings.dto';
import { ParseModePipe, ParseChannelPipe } from './mode.pipe';

@UseGuards(JwtAuthGuard)
@Controller('api')
export class DashboardController {
  constructor(
    private tradingService: TradingService,
    private strategyService: StrategyService,
    private marketDataService: MarketDataService,
    private cdcService: CdcActionZoneService,
    private settingsService: TradingSettingsService,
    private notificationSettingsService: NotificationSettingsService,
    private notificationService: NotificationService,
  ) {}

  /** สถานะ bot — returns pairs array + aggregate fields for backward compat */
  @Get('status')
  async getStatus(@Query('mode', new DefaultValuePipe('live'), ParseModePipe) mode: TradingMode = 'live') {
    const allSettings = await this.settingsService.getAllSettings(mode);

    // Sync all positions for this mode at once to avoid rate limits.
    // An exchange hiccup here must not 500 the whole status endpoint.
    try {
      await this.tradingService.syncPositions(mode);
    } catch { /* next poll retries */ }

    const pairs = await Promise.all(allSettings.map(async s => {

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
    @Query('mode', new DefaultValuePipe('live'), ParseModePipe) mode: TradingMode = 'live',
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
    if (!SYMBOL_PATTERN.test(symbol)) throw new BadRequestException('invalid symbol');
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
    if (!SYMBOL_PATTERN.test(symbol)) throw new BadRequestException('invalid symbol');
    if (timeframe && !VALID_TIMEFRAMES.includes(timeframe as any)) throw new BadRequestException('invalid timeframe');
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
  getSettingsByMode(@Param('mode', ParseModePipe) mode: TradingMode) {
    return this.settingsService.getAllSettings(mode);
  }

  /** Add a new trading pair to a mode */
  @Post('settings/:mode/pairs')
  async addPair(
    @Param('mode', ParseModePipe) mode: TradingMode,
    @Body() body: AddPairDto,
  ) {
    const pair = await this.settingsService.addPair(mode, body.symbol);
    await this.strategyService.addPairJob(mode, body.symbol);
    return pair;
  }

  /** Remove a trading pair from a mode */
  @Delete('settings/:mode/pairs')
  async removePair(
    @Param('mode', ParseModePipe) mode: TradingMode,
    @Query('symbol') symbol: string,
  ) {
    if (!symbol) throw new BadRequestException('symbol query param required');
    await this.tradingService.closeAllPositions(mode, symbol);

    // Never delete the cron/settings while positions are still open — that
    // would orphan them with no job managing exits.
    const remaining = await this.tradingService.getOpenPositions(mode, symbol);
    if (remaining.length) {
      throw new BadGatewayException(
        `ปิด position ไม่สำเร็จ ${remaining.length} รายการ — pair ยังไม่ถูกลบ กรุณาลองใหม่`,
      );
    }

    this.strategyService.removePairJob(mode, symbol);
    await this.settingsService.removePair(mode, symbol);

    // Close WS streams only when no other mode still trades this symbol
    const grouped = await this.settingsService.getAllGrouped();
    const stillUsed = [...grouped.live, ...grouped.sandbox].some(p => p.symbol === symbol);
    if (!stillUsed) this.marketDataService.closeStreamsForSymbol(symbol);

    return { ok: true };
  }

  /** ปิด position เดี่ยวด้วยมือ (manual market close) */
  @Post('positions/:id/close')
  async closePosition(@Param('id', ParseUUIDPipe) id: string) {
    const position = await this.tradingService.closePositionById(id);
    return { ok: true, position };
  }

  /** Update trading settings for a (mode, symbol) pair */
  @Put('settings/:mode')
  async updateSettings(
    @Param('mode', ParseModePipe) mode: TradingMode,
    @Body() body: UpdateSettingsDto,
  ) {
    const { symbol, ...fields } = body;

    // Reject unknown pairs up front — before any getSettings call, which would
    // otherwise auto-create a phantom row. Pairs are created only via addPair.
    const exists = (await this.settingsService.getAllSettings(mode)).some(p => p.symbol === symbol);
    if (!exists) {
      throw new NotFoundException(`no settings for ${mode}/${symbol} — add the pair first`);
    }

    if (fields.emaFast !== undefined || fields.emaSlow !== undefined) {
      const current = await this.settingsService.getSettings(mode, symbol);
      const fast = fields.emaFast ?? current.emaFast;
      const slow = fields.emaSlow ?? current.emaSlow;
      if (fast >= slow) {
        throw new BadRequestException('emaFast must be less than emaSlow');
      }
    }

    if (fields.orderSizeUsdt !== undefined || fields.leverage !== undefined) {
      const current = await this.settingsService.getSettings(mode, symbol);
      await this.tradingService.validateOrderSize(
        mode,
        symbol,
        fields.orderSizeUsdt ?? current.orderSizeUsdt,
        fields.leverage ?? current.leverage,
      );
    }

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

  /** LINE + Telegram notification settings for one mode — secrets always returned masked */
  @Get('settings/notifications/:mode')
  getNotificationSettings(@Param('mode', ParseModePipe) mode: NotificationMode) {
    return this.notificationSettingsService.getMaskedSettings(mode);
  }

  /** Update notification settings for one mode (both channels in one payload) */
  @Put('settings/notifications/:mode')
  updateNotificationSettings(
    @Param('mode', ParseModePipe) mode: NotificationMode,
    @Body() body: UpdateNotificationSettingsDto,
  ) {
    return this.notificationSettingsService.updateSettings(mode, body);
  }

  /**
   * Send a real test push on one channel for one mode. `lastSentAt` is only stamped when a
   * message actually went out — otherwise the dashboard's "last sent" line would lie about
   * a channel that has no credentials.
   */
  @Post('settings/notifications/:mode/test')
  async sendTestNotification(
    @Param('mode', ParseModePipe) mode: NotificationMode,
    @Query('channel', new DefaultValuePipe('line'), ParseChannelPipe) channel: NotificationChannel,
  ) {
    const sent = await this.notificationService.sendTest(mode, channel);
    if (!sent) {
      throw new BadRequestException(
        `ยังไม่ได้ตั้งค่า ${channel === 'telegram' ? 'Telegram' : 'LINE'} ของโหมด ${mode} — ส่งข้อความทดสอบไม่ได้`,
      );
    }
    return this.notificationSettingsService.markSent(mode, channel);
  }
}
