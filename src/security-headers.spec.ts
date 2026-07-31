import { Controller, Get, Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { securityHeaders } from './security-headers';

/**
 * Boots a real server with the exact middleware main.ts installs. The failure this
 * catches is silent: a CSP that drops script-src, or an 'unsafe-inline' creeping back in,
 * looks fine in code review and in the browser — right up until an XSS reads the JWT out
 * of localStorage.
 */

@Controller()
class PingController {
  @Get()
  ping() {
    return { ok: true };
  }
}

@Module({ controllers: [PingController] })
class HeaderTestModule {}

const bootWith = async (isProd: boolean) => {
  const app = await NestFactory.create(HeaderTestModule, { logger: false });
  app.use(securityHeaders(isProd));
  await app.listen(0);
  const url = (await app.getUrl()).replace('[::1]', '127.0.0.1');
  const res = await fetch(url);
  await app.close();
  return res.headers;
};

describe('securityHeaders', () => {
  it('sends a CSP with script-src self and no unsafe-inline', async () => {
    const headers = await bootWith(false);
    const csp = headers.get('content-security-policy');

    expect(csp).toContain("script-src 'self'");
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("object-src 'none'");
    // style-src is allowed to be inline; script-src never is. Scope the check to the
    // script-src directive itself — a whole-string search would trip over style-src's.
    const scriptSrc = csp!.split(';').find((d) => d.trim().startsWith('script-src'));
    expect(scriptSrc).toBe("script-src 'self'");
  });

  it('allows inline styles and data: URIs the dashboard actually needs', async () => {
    const csp = (await bootWith(false)).get('content-security-policy');

    expect(csp).toContain("style-src 'self' 'unsafe-inline'");
    expect(csp).toContain("img-src 'self' data:"); // favicon
    expect(csp).toContain("font-src 'self' data:");
    expect(csp).toContain("connect-src 'self'");
  });

  it('sets the other baseline headers', async () => {
    const headers = await bootWith(false);

    expect(headers.get('x-content-type-options')).toBe('nosniff');
    expect(headers.get('x-frame-options')).toBe('SAMEORIGIN');
    expect(headers.get('referrer-policy')).toBeTruthy();
  });

  it('sends HSTS only in production', async () => {
    expect((await bootWith(false)).get('strict-transport-security')).toBeNull();

    const prod = await bootWith(true);
    expect(prod.get('strict-transport-security')).toContain('max-age=15552000');
    expect(prod.get('content-security-policy')).toContain('upgrade-insecure-requests');
  });
});
