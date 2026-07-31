import { Controller, Get, Module } from '@nestjs/common';
import { APP_GUARD, NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { JwtAuthGuard } from './jwt-auth.guard';
import { Public } from './public.decorator';

/**
 * Boots a real HTTP server to prove the default-deny wiring, which unit tests can't see:
 * a controller that declares NO guard of its own must still 401 without a token, purely
 * because JwtAuthGuard is registered as an APP_GUARD. That is the property the whole
 * change rests on — before it, a controller added without @UseGuards was silently public.
 */

const SECRET = 'app-guard-wiring-spec-secret-32-chars!!';

@Controller('api/wiring')
class WiringController {
  // No @UseGuards, no @Public — the default case.
  @Get('guarded')
  guarded() {
    return { ok: true };
  }

  @Public()
  @Get('open')
  open() {
    return { ok: true };
  }
}

@Module({
  imports: [JwtModule.register({ secret: SECRET, signOptions: { algorithm: 'HS256' } })],
  controllers: [WiringController],
  providers: [
    { provide: ConfigService, useValue: { get: (k: string) => (k === 'jwt.secret' ? SECRET : null) } },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
  ],
})
class WiringTestModule {}

describe('JwtAuthGuard APP_GUARD wiring', () => {
  let app: any;
  let base: string;
  let token: string;

  beforeAll(async () => {
    app = await NestFactory.create(WiringTestModule, { logger: false });
    await app.listen(0);
    base = (await app.getUrl()).replace('[::1]', '127.0.0.1');
    token = app.get(JwtService).sign({ username: 'admin', sub: 1 });
  });

  afterAll(async () => {
    await app?.close();
  });

  it('401s an undecorated route when no token is sent', async () => {
    const res = await fetch(`${base}/api/wiring/guarded`);
    expect(res.status).toBe(401);
  });

  it('200s the same route with a valid Bearer token', async () => {
    const res = await fetch(`${base}/api/wiring/guarded`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);
  });

  it('200s a @Public() route with no token', async () => {
    const res = await fetch(`${base}/api/wiring/open`);
    expect(res.status).toBe(200);
  });
});
