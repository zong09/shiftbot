import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { TypeOrmModule } from '@nestjs/typeorm';
import configuration from './config/configuration';
import { PositionEntity } from './database/entities/position.entity';
import { TradeLogEntity } from './database/entities/trade-log.entity';
import { TradingSettingsEntity } from './database/entities/trading-settings.entity';
import { UserEntity } from './database/entities/user.entity';
import { TradingSettingsModule } from './modules/trading-settings/trading-settings.module';
import { MarketDataModule } from './modules/market-data/market-data.module';
import { IndicatorsModule } from './modules/indicators/indicators.module';
import { TradingModule } from './modules/trading/trading.module';
import { NotificationModule } from './modules/notification/notification.module';
import { StrategyModule } from './modules/strategy/strategy.module';
import { DashboardModule } from './modules/dashboard/dashboard.module';
import { AuthModule } from './modules/auth/auth.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, load: [configuration] }),
    ScheduleModule.forRoot(),
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        type: 'postgres',
        host:     config.get<string>('database.host'),
        port:     config.get<number>('database.port'),
        username: config.get<string>('database.user'),
        password: config.get<string>('database.password'),
        database: config.get<string>('database.name'),
        entities: [PositionEntity, TradeLogEntity, TradingSettingsEntity, UserEntity],
        synchronize: true,
      }),
    }),
    TradingSettingsModule,
    MarketDataModule,
    IndicatorsModule,
    TradingModule,
    NotificationModule,
    StrategyModule,
    DashboardModule,
    AuthModule,
  ],
})
export class AppModule {}
