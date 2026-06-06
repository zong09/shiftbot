import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn } from 'typeorm';

@Entity('trade_logs')
export class TradeLogEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @CreateDateColumn({ type: 'timestamptz' })
  timestamp: Date;

  @Column()
  symbol: string;

  @Column()
  action: string;

  @Column('float8')
  price: number;

  @Column('float8')
  quantity: number;

  @Column({ type: 'float8', nullable: true })
  pnl: number | null;

  @Column('int')
  zone: number;

  @Column()
  signal: string;

  @Column({ nullable: true })
  orderId: string | null;

  @Column({ default: 'live' })
  mode: string;
}
