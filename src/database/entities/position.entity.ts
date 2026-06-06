import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn } from 'typeorm';

@Entity('positions')
export class PositionEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  symbol: string;

  @Column()
  side: string;

  @Column('float8')
  entryPrice: number;

  @Column('float8')
  quantity: number;

  @Column('float8')
  stopLoss: number;

  @Column('float8')
  takeProfit: number;

  @CreateDateColumn({ type: 'timestamptz' })
  openTime: Date;

  @Column({ type: 'timestamptz', nullable: true })
  closeTime: Date | null;

  @Column({ type: 'float8', nullable: true })
  closedPnl: number | null;

  @Column({ default: 'open' })
  status: string;

  @Column({ default: 'live' })
  mode: string;
}
