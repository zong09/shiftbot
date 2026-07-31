import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
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
import { AddLineChannelSecret1785110400000 } from './database/migrations/1785110400000-AddLineChannelSecret';
import { AddTelegramNotificationSettings1785196800000 } from './database/migrations/1785196800000-AddTelegramNotificationSettings';
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
    // Global rate limit. Sized against the dashboard's own traffic: App.jsx polls on a
    // 30s REFRESH_INTERVAL and loadData() fires 4 endpoints per tick = 8 req/min per
    // open tab, so 120 leaves room for ~15 tabs from one IP. The throttler keys on IP,
    // not user — raise this if several operators share one NAT. Login overrides it
    // down to 5/min via @Throttle in auth.controller.ts.
    ThrottlerModule.forRoot([{ name: 'default', ttl: 60_000, limit: 120 }]),
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const url = config.get<string>('database.url');
        const isProd = process.env.NODE_ENV === 'production';
        // DB_SSL is the explicit answer; the hosted-provider substring sniff is only the
        // fallback for when it is unset. Production always uses SSL regardless.
        const sslEnv = process.env.DB_SSL;
        const useSsl =
          isProd ||
          (sslEnv !== undefined
            ? sslEnv === 'true'
            : !!(url && (url.includes('railway') || url.includes('supabase') || url.includes('neon'))));
        // Auto-sync schema in dev only — in production a schema drift must never
        // silently ALTER live trading tables; use migrations instead.
        const synchronize = !isProd;
        // Migrations are listed explicitly (not by glob) so they resolve the same
        // way in dev (ts) and in the compiled dist build.
        const migrations = [
          CreateNotificationSettings1785024000000,
          AddLineChannelSecret1785110400000,
          AddTelegramNotificationSettings1785196800000,
        ];
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
  providers: [
    // Every route is rate-limited, including the public LINE webhook. Registered in the
    // root module so it runs before AuthModule's APP_GUARD — an unauthenticated flood
    // gets throttled before it reaches JWT verification.
    { provide: APP_GUARD, useClass: ThrottlerGuard },
  ],
})
export class AppModule {}
