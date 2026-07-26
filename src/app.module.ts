import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { ThrottlerModule } from '@nestjs/throttler';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ServeStaticModule } from '@nestjs/serve-static';
import { join } from 'path';
import configuration from './config/configuration';
import { PositionEntity } from './database/entities/position.entity';
import { TradeLogEntity } from './database/entities/trade-log.entity';
import { TradingSettingsEntity } from './database/entities/trading-settings.entity';
import { NotificationSettingsEntity } from './database/entities/notification-settings.entity';
import { UserEntity } from './database/entities/user.entity';
import { CreateNotificationSettings1785024000000 } from './database/migrations/1785024000000-CreateNotificationSettings';
import { TradingSettingsModule } from './modules/trading-settings/trading-settings.module';
import { NotificationSettingsModule } from './modules/notification-settings/notification-settings.module';
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
    // Rate-limit config consumed by ThrottlerGuard on the login endpoint
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 5 }]),
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const url = config.get<string>('database.url');
        const isProd = process.env.NODE_ENV === 'production';
        const useSsl = isProd || (url && (url.includes('railway') || url.includes('supabase') || url.includes('neon')));
        // Auto-sync schema in dev only — in production a schema drift must never
        // silently ALTER live trading tables; use migrations instead.
        const synchronize = !isProd;
        // Migrations are listed explicitly (not by glob) so they resolve the same
        // way in dev (ts) and in the compiled dist build.
        const migrations = [CreateNotificationSettings1785024000000];
        // Verify the DB certificate unless explicitly disabled for hosts with self-signed certs.
        const rejectUnauthorized = process.env.DB_SSL_REJECT_UNAUTHORIZED !== 'false';

        if (url) {
          return {
            type: 'postgres',
            url,
            entities: [PositionEntity, TradeLogEntity, TradingSettingsEntity, NotificationSettingsEntity, UserEntity],
            synchronize,
            migrations,
            migrationsRun: true,
            ssl: useSsl ? { rejectUnauthorized } : false,
            retryAttempts: 2,
          };
        }
        return {
          type: 'postgres',
          host:     config.get<string>('database.host'),
          port:     config.get<number>('database.port'),
          username: config.get<string>('database.user'),
          password: config.get<string>('database.password'),
          database: config.get<string>('database.name'),
          entities: [PositionEntity, TradeLogEntity, TradingSettingsEntity, NotificationSettingsEntity, UserEntity],
          synchronize,
          migrations,
          migrationsRun: true,
          ssl: useSsl ? { rejectUnauthorized } : false,
          retryAttempts: 2,
        };
      },
    }),
    ServeStaticModule.forRoot({
      rootPath: join(__dirname, '..', 'dashboard', 'dist'),
      exclude: ['/api/(.*)'],
    }),
    TradingSettingsModule,
    NotificationSettingsModule,
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
