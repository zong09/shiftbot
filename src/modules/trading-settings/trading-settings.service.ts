import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { TradingSettingsEntity } from '../../database/entities/trading-settings.entity';

export type TradingMode = 'live' | 'sandbox';
export type TradingStatus = 'on' | 'pause' | 'off';

const DEFAULTS: Record<TradingMode, Omit<TradingSettingsEntity, 'mode' | 'updatedAt'>> = {
  live: {
    symbol: 'BTC/USDT:USDT', timeframe: '1h',
    leverage: 5, orderSizeUsdt: 100, maxPositions: 1,
    stopLossPct: 2.0, takeProfitPct: 4.0,
    emaFast: 12, emaSlow: 26,
    status: 'on',
  },
  sandbox: {
    symbol: 'BTC/USDT:USDT', timeframe: '1h',
    leverage: 5, orderSizeUsdt: 100, maxPositions: 1,
    stopLossPct: 2.0, takeProfitPct: 4.0,
    emaFast: 12, emaSlow: 26,
    status: 'on',
  },
};

@Injectable()
export class TradingSettingsService {
  constructor(
    @InjectRepository(TradingSettingsEntity)
    private repo: Repository<TradingSettingsEntity>,
  ) {}

  async getSettings(mode: TradingMode): Promise<TradingSettingsEntity> {
    let row = await this.repo.findOne({ where: { mode } });
    if (!row) {
      row = await this.repo.save(this.repo.create({ mode, ...DEFAULTS[mode] }));
    }
    return row;
  }

  async updateSettings(
    mode: TradingMode,
    dto: Partial<Omit<TradingSettingsEntity, 'mode' | 'updatedAt'>>,
  ): Promise<TradingSettingsEntity> {
    await this.repo.upsert({ mode, ...dto }, ['mode']);
    return this.getSettings(mode);
  }

  async getAllSettings(): Promise<{ live: TradingSettingsEntity; sandbox: TradingSettingsEntity }> {
    const [live, sandbox] = await Promise.all([
      this.getSettings('live'),
      this.getSettings('sandbox'),
    ]);
    return { live, sandbox };
  }
}
