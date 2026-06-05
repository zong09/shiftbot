import { Controller, Get } from '@nestjs/common';
import { TradingService } from '../trading/trading.service';
import { StrategyService } from '../strategy/strategy.service';
import { MarketDataService } from '../market-data/market-data.service';
import { CdcActionZoneService } from '../indicators/cdc-action-zone.service';

@Controller('api')
export class DashboardController {
  constructor(
    private tradingService: TradingService,
    private strategyService: StrategyService,
    private marketDataService: MarketDataService,
    private cdcService: CdcActionZoneService,
  ) {}

  /** สถานะ bot และ position ปัจจุบัน */
  @Get('status')
  getStatus() {
    const positions = this.tradingService.getOpenPositions();
    const lastCdc   = this.strategyService.getLastResult();
    return {
      status:       'running',
      symbol:       this.marketDataService.getSymbol(),
      timeframe:    this.marketDataService.getTimeframe(),
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
      totalPnl: this.tradingService.getTotalPnl().toFixed(2),
      timestamp: new Date().toISOString(),
    };
  }

  /** ประวัติ trade ทั้งหมด */
  @Get('trades')
  getTrades() {
    return {
      trades: this.tradingService.getTradeHistory(),
      total:  this.tradingService.getTradeHistory().length,
      pnl:    this.tradingService.getTotalPnl().toFixed(2),
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

  /** Health check */
  @Get('health')
  health() {
    return { status: 'ok', uptime: process.uptime(), timestamp: new Date().toISOString() };
  }
}
