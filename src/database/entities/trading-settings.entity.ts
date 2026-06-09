import { Entity, PrimaryColumn, Column, UpdateDateColumn } from 'typeorm';

@Entity('trading_settings')
export class TradingSettingsEntity {
  @PrimaryColumn()
  mode: string;  // 'live' | 'sandbox'

  @PrimaryColumn()
  symbol: string;  // e.g. 'BTC/USDT:USDT'

  @Column({ default: '1h' })
  timeframe: string;

  @Column('int', { default: 5 })
  leverage: number;

  @Column('float8', { default: 100 })
  orderSizeUsdt: number;

  @Column('int', { default: 1 })
  maxPositions: number;

  @Column('float8', { default: 2.0 })
  stopLossPct: number;

  @Column('float8', { default: 4.0 })
  takeProfitPct: number;

  @Column('int', { default: 12 })
  emaFast: number;

  @Column('int', { default: 26 })
  emaSlow: number;

  @Column({ default: 'on' })
  status: string;  // 'on' | 'pause' | 'off'

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
