import { Controller, Get, Module } from '@nestjs/common';
import { APP_GUARD, NestFactory } from '@nestjs/core';
import { Throttle, ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';

/**
 * The rate limit used to exist only on AuthController. Making ThrottlerGuard an APP_GUARD
 * is what covers the rest — including the public LINE webhook — and a @Throttle override
 * is what keeps login stricter than the global floor. Both are silent when broken: the
 * app serves 200s either way, and you find out during the brute-force attempt.
 *
 * Limits here are tiny so the test is fast; the real numbers are in app.module.ts
 * (120/60s global) and auth.controller.ts (5/60s on login).
 */

@Controller('api/rl')
class RateLimitedController {
  // No decorator — covered purely by the global guard.
  @Get('default')
  def() {
    return { ok: true };
  }

  @Throttle({ default: { limit: 2, ttl: 60_000 } })
  @Get('strict')
  strict() {
    return { ok: true };
  }
}

@Module({
  imports: [ThrottlerModule.forRoot([{ name: 'default', ttl: 60_000, limit: 4 }])],
  controllers: [RateLimitedController],
  providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
})
class ThrottlerTestModule {}

describe('ThrottlerGuard APP_GUARD wiring', () => {
  let app: any;
  let base: string;

  beforeAll(async () => {
    app = await NestFactory.create(ThrottlerTestModule, { logger: false });
    await app.listen(0);
    base = (await app.getUrl()).replace('[::1]', '127.0.0.1');
  });

  afterAll(async () => {
    await app?.close();
  });

  const hit = async (path: string, times: number) => {
    const codes: number[] = [];
    for (let i = 0; i < times; i++) {
      codes.push((await fetch(`${base}/api/rl/${path}`)).status);
    }
    return codes;
  };

  it('429s an undecorated route once the global limit is exceeded', async () => {
    const codes = await hit('default', 5);
    expect(codes.slice(0, 4)).toEqual([200, 200, 200, 200]);
    expect(codes[4]).toBe(429);
  });

  it('applies a stricter @Throttle override before the global limit is reached', async () => {
    const codes = await hit('strict', 3);
    expect(codes.slice(0, 2)).toEqual([200, 200]);
    expect(codes[2]).toBe(429);
  });
});
