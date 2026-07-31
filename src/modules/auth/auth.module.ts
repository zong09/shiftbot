import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { UserEntity } from '../../database/entities/user.entity';
import { JwtAuthGuard } from './jwt-auth.guard';

@Module({
  imports: [
    TypeOrmModule.forFeature([UserEntity]),
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        secret: configService.get<string>('jwt.secret'),
        signOptions: {
          expiresIn: configService.get<string>('jwt.expiry') || '24h',
          // Sign explicitly with HS256 so the verifier's algorithm pin
          // (jwt-auth.guard.ts) can never drift away from what we issue.
          algorithm: 'HS256',
        },
      }),
    }),
  ],
  providers: [
    AuthService,
    JwtAuthGuard,
    // Default-deny: every route needs a JWT unless it declares @Public().
    // Registered here rather than in AppModule so DI resolves JwtService/ConfigService
    // from this module's own imports without making AuthModule global.
    { provide: APP_GUARD, useClass: JwtAuthGuard },
  ],
  controllers: [AuthController],
  exports: [AuthService, JwtAuthGuard, JwtModule],
})
export class AuthModule {}
