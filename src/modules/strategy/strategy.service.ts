import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { ConfigService } from '@nestjs/config';
import { MarketDataService } from '../market-data/market-data.service';
import { CdcActionZoneService } from '../indicators/cdc-action-zone.service';
import { TradingService } from '../trading/trading.service';
import { NotificationService } from '../notification/notification.service';
import { CDCZone, CDCResult } from '../../common/types';

@Injectable()
export class StrategyService {
  private readonly logger = new Logger(StrategyService.name);
  private lastZone: CDCZone | undefined = undefined;
  private lastResult: CDCResult | null = null;
  private isRunning = false;
  private timeframe: string;

  constructor(
    private configService: ConfigService,
    private marketDataService: MarketDataService,
    private cdcService: CdcActionZoneService,
    private tradingService: TradingService,
    private notificationService: NotificationService,
  ) {
    this.timeframe = this.configService.get<string>('trading.timeframe', '1h');
  }

  /**
   * รัน strategy ทุกครั้งที่ candle ปิด
   * Cron expression ตาม timeframe:
   *   1m  → ทุกนาที
   *   5m  → ทุก 5 นาที
   *   15m → ทุก 15 นาที
   *   1h  → ทุกชั่วโมง
   *   4h  → ทุก 4 ชั่วโมง
   *   1d  → ทุกวัน 00:00
   *
   * เปลี่ยน Cron ใน decorator ให้ตรงกับ TIMEFRAME ใน .env
   */
  @Cron('0 * * * *') // default: 1h — เปลี่ยนตาม timeframe
  async runStrategy() {
    if (this.isRunning) {
      this.logger.warn('Strategy กำลังทำงาน รอให้เสร็จก่อน');
      return;
    }
    this.isRunning = true;

    try {
      this.logger.log('=== เริ่มรัน CDC Strategy ===');

      // 1. ดึง OHLCV
      const candles = await this.marketDataService.fetchOHLCV(200);
      if (!candles.length) {
        this.logger.warn('ไม่ได้รับ candle data');
        return;
      }

      // 2. คำนวณ CDC Action Zone
      const result = this.cdcService.calculate(candles, this.lastZone);
      if (!result) return;

      this.lastResult = result;
      const currentPrice = result.close;

      // 3. ตรวจ SL/TP ก่อนเสมอ
      await this.tradingService.checkSLTP(currentPrice, result.zone);

      // 4. ประมวล signal
      if (result.signal === 'BUY') {
        this.logger.log(`🟢 BUY Signal | Zone: ${result.zoneName}`);
        await this.notificationService.sendSignal('BUY', result, currentPrice);

        if (!this.tradingService.hasOpenPosition()) {
          const position = await this.tradingService.openLong(currentPrice, result.zone);
          if (position) {
            await this.notificationService.sendOpenPosition(position);
          }
        }

      } else if (result.signal === 'SELL') {
        this.logger.log(`🔴 SELL Signal | Zone: ${result.zoneName}`);
        await this.notificationService.sendSignal('SELL', result, currentPrice);

        const positions = this.tradingService.getOpenPositions();
        for (const pos of positions) {
          if (pos.side === 'long') {
            await this.tradingService.closeLong(pos, currentPrice, result.zone, 'SIGNAL');
            await this.notificationService.sendClosePosition(pos, 'SIGNAL', currentPrice);
          }
        }

      } else {
        this.logger.log(`⏸  HOLD | Zone: ${result.zoneName} (${result.zone})`);
      }

      // 5. อัพเดต lastZone
      this.lastZone = result.zone;
    } catch (err) {
      this.logger.error('runStrategy error: ' + err.message);
      await this.notificationService.sendError(err.message);
    } finally {
      this.isRunning = false;
    }
  }

  getLastResult(): CDCResult | null {
    return this.lastResult;
  }
}
