import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import configuration from './config/configuration';
import { MarketDataModule } from './modules/market-data/market-data.module';
import { IndicatorsModule } from './modules/indicators/indicators.module';
import { TradingModule } from './modules/trading/trading.module';
import { NotificationModule } from './modules/notification/notification.module';
import { StrategyModule } from './modules/strategy/strategy.module';
import { DashboardModule } from './modules/dashboard/dashboard.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, load: [configuration] }),
    ScheduleModule.forRoot(),
    MarketDataModule,
    IndicatorsModule,
    TradingModule,
    NotificationModule,
    StrategyModule,
    DashboardModule,
  ],
})
export class AppModule {}
