import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { TradingService } from './trading.service';
import { MarketDataModule } from '../market-data/market-data.module';
import { TradingSettingsModule } from '../trading-settings/trading-settings.module';
import { NotificationModule } from '../notification/notification.module';
import { PositionEntity } from '../../database/entities/position.entity';
import { TradeLogEntity } from '../../database/entities/trade-log.entity';

@Module({
  imports: [
    MarketDataModule,
    TradingSettingsModule,
    NotificationModule,
    TypeOrmModule.forFeature([PositionEntity, TradeLogEntity]),
  ],
  providers: [TradingService],
  exports: [TradingService],
})
export class TradingModule {}
