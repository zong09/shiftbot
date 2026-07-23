import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { TradingSettingsEntity } from '../../database/entities/trading-settings.entity';

export type TradingMode = 'live' | 'sandbox';
export type TradingStatus = 'on' | 'pause' | 'off';

type SettingsFields = Omit<TradingSettingsEntity, 'mode' | 'symbol' | 'updatedAt'>;

function defaultFields(): SettingsFields {
  return {
    timeframe: '1h', leverage: 5, orderSizeUsdt: 100, maxPositions: 1,
    stopLossPct: 2.0, takeProfitPct: 4.0, emaFast: 12, emaSlow: 26, status: 'on',
  };
}

@Injectable()
export class TradingSettingsService {
  constructor(
    @InjectRepository(TradingSettingsEntity)
    private repo: Repository<TradingSettingsEntity>,
  ) {}

  async getSettings(mode: TradingMode, symbol: string): Promise<TradingSettingsEntity> {
    let row = await this.repo.findOne({ where: { mode, symbol } });
    if (!row) {
      // upsert (not save) so two concurrent first-time callers for the same
      // (mode, symbol) composite PK don't collide on a unique-violation.
      await this.repo.upsert({ mode, symbol, ...defaultFields() }, ['mode', 'symbol']);
      row = await this.repo.findOne({ where: { mode, symbol } });
    }
    return row!;
  }

  async getAllSettings(mode: TradingMode): Promise<TradingSettingsEntity[]> {
    return this.repo.find({ where: { mode } });
  }

  // Ensures at least BTC/USDT:USDT exists for each mode on first boot.
  async seedIfEmpty(mode: TradingMode): Promise<TradingSettingsEntity[]> {
    const rows = await this.getAllSettings(mode);
    if (!rows.length) {
      return [await this.addPair(mode, 'BTC/USDT:USDT')];
    }
    return rows;
  }

  async updateSettings(
    mode: TradingMode,
    symbol: string,
    dto: Partial<SettingsFields>,
  ): Promise<TradingSettingsEntity> {
    // update (not upsert): a settings row must be created only via addPair, which
    // also schedules its cron job. Upserting here would create a phantom pair with
    // no job managing it.
    const existing = await this.repo.findOne({ where: { mode, symbol } });
    if (!existing) {
      throw new NotFoundException(`no settings for ${mode}/${symbol} — add the pair first`);
    }
    await this.repo.update({ mode, symbol }, dto);
    return this.getSettings(mode, symbol);
  }

  async addPair(mode: TradingMode, symbol: string, overrides?: Partial<SettingsFields>): Promise<TradingSettingsEntity> {
    const existing = await this.repo.findOne({ where: { mode, symbol } });
    if (existing) return existing;
    return this.repo.save(this.repo.create({ mode, symbol, ...defaultFields(), ...overrides }));
  }

  async removePair(mode: TradingMode, symbol: string): Promise<void> {
    await this.repo.delete({ mode, symbol });
  }

  async getAllGrouped(): Promise<{ live: TradingSettingsEntity[]; sandbox: TradingSettingsEntity[] }> {
    const [live, sandbox] = await Promise.all([
      this.seedIfEmpty('live'),
      this.seedIfEmpty('sandbox'),
    ]);
    return { live, sandbox };
  }
}
