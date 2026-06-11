import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { SchedulerRegistry } from '@nestjs/schedule';
import { CronJob } from 'cron';
import { MarketDataService } from '../market-data/market-data.service';
import { CdcActionZoneService } from '../indicators/cdc-action-zone.service';
import { TradingService, TradingMode } from '../trading/trading.service';
import { NotificationService } from '../notification/notification.service';
import { TradingSettingsService } from '../trading-settings/trading-settings.service';
import { CDCZone, CDCResult } from '../../common/types';

interface PairContext {
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

const TIMEFRAME_MS: Record<string, number> = {
  '1m':  60_000,
  '5m':  300_000,
  '15m': 900_000,
  '1h':  3_600_000,
  '4h':  14_400_000,
  '1d':  86_400_000,
};

function timeframeToCron(timeframe: string): string {
  return TIMEFRAME_CRON[timeframe] ?? '0 * * * *';
}

function ctxKey(mode: TradingMode, symbol: string): string {
  return `${mode}:${symbol}`;
}

function jobName(mode: TradingMode, symbol: string): string {
  return `strategy-${mode}-${symbol.replace(/[/:]/g, '_')}`;
}

@Injectable()
export class StrategyService implements OnModuleInit {
  private readonly logger = new Logger(StrategyService.name);

  private contexts = new Map<string, PairContext>();

  constructor(
    private marketDataService: MarketDataService,
    private cdcService: CdcActionZoneService,
    private tradingService: TradingService,
    private notificationService: NotificationService,
    private settingsService: TradingSettingsService,
    private schedulerRegistry: SchedulerRegistry,
  ) {}

  async onModuleInit() {
    const modes: TradingMode[] = ['live', 'sandbox'];
    const allSettings = (await Promise.all(
      modes.map(m => this.settingsService.seedIfEmpty(m)),
    )).flat();
    await Promise.all(allSettings.map(s => this.reschedule(s.mode as TradingMode, s.symbol)));
  }

  async reschedule(mode: TradingMode, symbol: string): Promise<void> {
    const name = jobName(mode, symbol);
    const s = await this.settingsService.getSettings(mode, symbol);
    const cronExpr = timeframeToCron(s.timeframe);

    if (this.schedulerRegistry.doesExist('cron', name)) {
      this.schedulerRegistry.deleteCronJob(name);
    }

    if (!this.contexts.has(ctxKey(mode, symbol))) {
      this.contexts.set(ctxKey(mode, symbol), { lastZone: undefined, lastResult: null, isRunning: false });
    }

    const job = new CronJob(cronExpr, () => {
      this.runForPair(mode, symbol).catch((err) =>
        this.logger.error(`[${mode}][${symbol}] unhandled error: ${err.message}`),
      );
    });

    this.schedulerRegistry.addCronJob(name, job);
    job.start();

    this.logger.log(`[${mode}][${symbol}] scheduled cron: "${cronExpr}" (timeframe: ${s.timeframe})`);
  }

  async addPairJob(mode: TradingMode, symbol: string): Promise<void> {
    await this.reschedule(mode, symbol);
  }

  removePairJob(mode: TradingMode, symbol: string): void {
    const name = jobName(mode, symbol);
    if (this.schedulerRegistry.doesExist('cron', name)) {
      this.schedulerRegistry.deleteCronJob(name);
    }
    this.contexts.delete(ctxKey(mode, symbol));
    this.logger.log(`[${mode}][${symbol}] pair job removed`);
  }

  private async runForPair(mode: TradingMode, symbol: string): Promise<void> {
    const key = ctxKey(mode, symbol);
    if (!this.contexts.has(key)) {
      this.contexts.set(key, { lastZone: undefined, lastResult: null, isRunning: false });
    }
    const ctx = this.contexts.get(key)!;

    if (ctx.isRunning) {
      this.logger.warn(`[${mode}][${symbol}] Strategy กำลังทำงาน รอให้เสร็จก่อน`);
      return;
    }
    ctx.isRunning = true;

    try {
      const s = await this.settingsService.getSettings(mode, symbol);

      if (s.status === 'off') {
        this.logger.debug(`[${mode}][${symbol}] status=off — skipped`);
        return;
      }

      this.logger.log(`=== [${mode}][${symbol}] เริ่มรัน CDC Strategy (status: ${s.status}) ===`);

      const candles = await this.marketDataService.fetchOHLCVByTimeframe(200, s.timeframe, symbol);
      if (!candles.length) {
        this.logger.warn(`[${mode}][${symbol}] ไม่ได้รับ candle data`);
        return;
      }

      // ใช้เฉพาะแท่งที่ปิดแล้ว — แท่งสุดท้ายจาก Binance คือแท่ง live ที่ยังไม่ confirm
      const tfMs = TIMEFRAME_MS[s.timeframe] ?? 3_600_000;
      const confirmed = candles.filter((c) => c.timestamp + tfMs <= Date.now());

      const result = this.cdcService.calculate(confirmed, ctx.lastZone, s.emaFast, s.emaSlow);
      if (!result) return;

      ctx.lastResult = result;
      const currentPrice = result.close;

      await this.tradingService.checkSLTP(currentPrice, result.zone, mode, symbol);

      if (s.status === 'pause') {
        this.logger.log(`[${mode}][${symbol}] status=pause — SLTP checked, signals skipped`);
        ctx.lastZone = result.zone;
        return;
      }

      if (result.signal === 'BUY') {
        this.logger.log(`[${mode}][${symbol}] 🟢 BUY Signal | Zone: ${result.zoneName}`);

        if (mode === 'live') {
          await this.notificationService.sendSignal('BUY', result, currentPrice);
        }

        if (!await this.tradingService.hasOpenPosition(mode, symbol)) {
          const position = await this.tradingService.openLong(currentPrice, result.zone, mode, symbol);
          if (position && mode === 'live') {
            await this.notificationService.sendOpenPosition(position);
          }
        }

      } else if (result.signal === 'SELL') {
        this.logger.log(`[${mode}][${symbol}] 🔴 SELL Signal | Zone: ${result.zoneName}`);

        if (mode === 'live') {
          await this.notificationService.sendSignal('SELL', result, currentPrice);
        }

        const positions = await this.tradingService.getOpenPositions(mode, symbol);
        for (const pos of positions) {
          if (pos.side === 'long') {
            await this.tradingService.closeLong(pos, currentPrice, result.zone, 'SIGNAL', mode);
            if (mode === 'live') {
              await this.notificationService.sendClosePosition(pos, 'SIGNAL', currentPrice);
            }
          }
        }

      } else {
        this.logger.log(`[${mode}][${symbol}] ⏸  HOLD | Zone: ${result.zoneName} (${result.zone})`);
      }

      ctx.lastZone = result.zone;
    } catch (err) {
      this.logger.error(`[${mode}][${symbol}] runStrategy error: ` + err.message);
      if (mode === 'live') {
        await this.notificationService.sendError(err.message);
      }
    } finally {
      ctx.isRunning = false;
    }
  }

  async runStrategy(): Promise<void> {
    const allSettings = (await Promise.all(
      (['live', 'sandbox'] as TradingMode[]).map(m => this.settingsService.getAllSettings(m)),
    )).flat();
    await Promise.all(allSettings.map(s => this.runForPair(s.mode as TradingMode, s.symbol)));
  }

  getLastResult(mode: TradingMode, symbol: string): CDCResult | null {
    return this.contexts.get(ctxKey(mode, symbol))?.lastResult ?? null;
  }
}
