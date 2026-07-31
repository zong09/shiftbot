import { existsSync, readdirSync } from 'fs';
import { join } from 'path';
import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { APP_GUARD, NestFactory } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import { ServeStaticModule } from '@nestjs/serve-static';
import { JwtAuthGuard } from './modules/auth/jwt-auth.guard';

/**
 * The dashboard is served by ServeStaticModule from the same process that now runs a
 * default-deny APP_GUARD. If the guard reaches the static handler, the production
 * dashboard 401s and renders nothing — a total failure, and one no unit test would see.
 * ServeStaticModule also registers an SPA index fallback, which is a real route and
 * therefore exactly the kind of thing an APP_GUARD attaches to, so "it's only
 * middleware" is not a safe assumption to rely on.
 */

const DIST = join(__dirname, '..', 'dashboard', 'dist');
const built = existsSync(join(DIST, 'index.html'));

@Module({
  imports: [
    ServeStaticModule.forRoot({ rootPath: DIST, exclude: ['/api/(.*)'] }),
    JwtModule.register({ secret: 'static-spec-secret-at-least-32-chars!' }),
  ],
  providers: [
    { provide: ConfigService, useValue: { get: () => 'static-spec-secret-at-least-32-chars!' } },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
  ],
})
class StaticTestModule {}

// Skipped rather than failed when dashboard/dist is absent — a bare `npm test` on a fresh
// clone has not run `npm run build` yet.
(built ? describe : describe.skip)('dashboard static serving under the global auth guard', () => {
  let app: any;
  let base: string;

  beforeAll(async () => {
    app = await NestFactory.create(StaticTestModule, { logger: false });
    await app.listen(0);
    base = (await app.getUrl()).replace('[::1]', '127.0.0.1');
  });

  // ServeStaticModule's file-serving middleware keeps handles around; shutdown routinely
  // takes longer than jest's 5s default.
  afterAll(async () => {
    await app?.close();
  }, 20_000);

  it('serves index.html with no Authorization header', async () => {
    const res = await fetch(`${base}/`);
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('<div id="root">');
  });

  it('serves the hashed JS bundle with no Authorization header', async () => {
    const asset = readdirSync(join(DIST, 'assets')).find((f) => f.endsWith('.js'));
    expect(asset).toBeDefined();

    const res = await fetch(`${base}/assets/${asset}`);
    expect(res.status).toBe(200);
  });

  it('serves the extracted theme pre-paint script (CSP needs it external)', async () => {
    const res = await fetch(`${base}/theme-init.js`);
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('shiftbot-theme');
  });
});
