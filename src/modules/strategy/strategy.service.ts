import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { SchedulerRegistry } from '@nestjs/schedule';
import { CronJob } from 'cron';
import { MarketDataService } from '../market-data/market-data.service';
import { CdcActionZoneService } from '../indicators/cdc-action-zone.service';
import { TradingService, TradingMode } from '../trading/trading.service';
import { NotificationService } from '../notification/notification.service';
import { TradingSettingsService } from '../trading-settings/trading-settings.service';
import { CDCZone, CDCResult } from '../../common/types';

interface ModeContext {
  lastZone: CDCZone | undefined;
  lastResult: CDCResult | null;
  isRunning: boolean;
}

const TIMEFRAME_CRON: Record<string, string> = {
  '1m':  '* * * * *',
  '5m':  '*/5 * * * *',
  '15m': '*/15 * * * *',
  '1h':  '0 * * * *',
  '4h':  '0 */4 * * *',
  '1d':  '0 0 * * *',
};

function timeframeToCron(timeframe: string): string {
  return TIMEFRAME_CRON[timeframe] ?? '0 * * * *';
}

@Injectable()
export class StrategyService implements OnModuleInit {
  private readonly logger = new Logger(StrategyService.name);

  private contexts: Record<TradingMode, ModeContext> = {
    live:    { lastZone: undefined, lastResult: null, isRunning: false },
    sandbox: { lastZone: undefined, lastResult: null, isRunning: false },
  };

  constructor(
    private marketDataService: MarketDataService,
    private cdcService: CdcActionZoneService,
    private tradingService: TradingService,
    private notificationService: NotificationService,
    private settingsService: TradingSettingsService,
    private schedulerRegistry: SchedulerRegistry,
  ) {}

  async onModuleInit() {
    await Promise.all([
      this.reschedule('live'),
      this.reschedule('sandbox'),
    ]);
  }

  async reschedule(mode: TradingMode): Promise<void> {
    const jobName = `strategy-${mode}`;
    const s = await this.settingsService.getSettings(mode);
    const cronExpr = timeframeToCron(s.timeframe);

    if (this.schedulerRegistry.doesExist('cron', jobName)) {
      this.schedulerRegistry.deleteCronJob(jobName);
    }

    const job = new CronJob(cronExpr, () => {
      this.runForMode(mode).catch((err) =>
        this.logger.error(`[${mode}] unhandled error: ${err.message}`),
      );
    });

    this.schedulerRegistry.addCronJob(jobName, job);
    job.start();

    this.logger.log(`[${mode}] scheduled cron: "${cronExpr}" (timeframe: ${s.timeframe})`);
  }

  private async runForMode(mode: TradingMode): Promise<void> {
    const ctx = this.contexts[mode];
    if (ctx.isRunning) {
      this.logger.warn(`[${mode}] Strategy กำลังทำงาน รอให้เสร็จก่อน`);
      return;
    }
    ctx.isRunning = true;

    try {
      const s = await this.settingsService.getSettings(mode);

      if (s.status === 'off') {
        this.logger.debug(`[${mode}] status=off — skipped`);
        return;
      }

      this.logger.log(`=== [${mode}] เริ่มรัน CDC Strategy (status: ${s.status}) ===`);

      const candles = await this.marketDataService.fetchOHLCVByTimeframe(200, s.timeframe);
      if (!candles.length) {
        this.logger.warn(`[${mode}] ไม่ได้รับ candle data`);
        return;
      }

      const result = this.cdcService.calculate(candles, ctx.lastZone, s.emaFast, s.emaSlow);
      if (!result) return;

      ctx.lastResult = result;
      const currentPrice = result.close;

      await this.tradingService.checkSLTP(currentPrice, result.zone, mode);

      if (s.status === 'pause') {
        this.logger.log(`[${mode}] status=pause — SLTP checked, signals skipped`);
        ctx.lastZone = result.zone;
        return;
      }

      if (result.signal === 'BUY') {
        this.logger.log(`[${mode}] 🟢 BUY Signal | Zone: ${result.zoneName}`);

        if (mode === 'live') {
          await this.notificationService.sendSignal('BUY', result, currentPrice);
        }

        if (!await this.tradingService.hasOpenPosition(mode)) {
          const position = await this.tradingService.openLong(currentPrice, result.zone, mode);
          if (position && mode === 'live') {
            await this.notificationService.sendOpenPosition(position);
          }
        }

      } else if (result.signal === 'SELL') {
        this.logger.log(`[${mode}] 🔴 SELL Signal | Zone: ${result.zoneName}`);

        if (mode === 'live') {
          await this.notificationService.sendSignal('SELL', result, currentPrice);
        }

        const positions = await this.tradingService.getOpenPositions(mode);
        for (const pos of positions) {
          if (pos.side === 'long') {
            await this.tradingService.closeLong(pos, currentPrice, result.zone, 'SIGNAL', mode);
            if (mode === 'live') {
              await this.notificationService.sendClosePosition(pos, 'SIGNAL', currentPrice);
            }
          }
        }

      } else {
        this.logger.log(`[${mode}] ⏸  HOLD | Zone: ${result.zoneName} (${result.zone})`);
      }

      ctx.lastZone = result.zone;
    } catch (err) {
      this.logger.error(`[${mode}] runStrategy error: ` + err.message);
      if (mode === 'live') {
        await this.notificationService.sendError(err.message);
      }
    } finally {
      ctx.isRunning = false;
    }
  }

  async runStrategy(): Promise<void> {
    await Promise.all([
      this.runForMode('live'),
      this.runForMode('sandbox'),
    ]);
  }

  getLastResult(mode: TradingMode = 'live'): CDCResult | null {
    return this.contexts[mode].lastResult;
  }
}
