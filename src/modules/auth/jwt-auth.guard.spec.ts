import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { JwtAuthGuard } from './jwt-auth.guard';
import { Public } from './public.decorator';

const SECRET = 'test-secret-at-least-32-characters-long!!';

// JwtAuthGuard is registered as an APP_GUARD, so these cases are the only thing standing
// between the public internet and every /api route. dashboard.controller.spec.ts stubs the
// guard out with `canActivate: () => true`, so nothing there covers rejection.
describe('JwtAuthGuard', () => {
  let guard: JwtAuthGuard;
  let jwtService: JwtService;

  class GuardedController {
    guardedRoute() {}

    @Public()
    publicRoute() {}
  }

  const configService = {
    get: (key: string) => (key === 'jwt.secret' ? SECRET : null),
  } as any;

  const contextFor = (
    authorization: string | undefined,
    handler: (...args: any[]) => any = GuardedController.prototype.guardedRoute,
  ): { context: ExecutionContext; request: Record<string, any> } => {
    const request: Record<string, any> = { headers: authorization ? { authorization } : {} };
    const context = {
      switchToHttp: () => ({ getRequest: () => request }),
      getHandler: () => handler,
      getClass: () => GuardedController,
    } as unknown as ExecutionContext;
    return { context, request };
  };

  beforeEach(() => {
    jwtService = new JwtService({ secret: SECRET, signOptions: { algorithm: 'HS256' } });
    // A real Reflector, not a mock — the @Public() bypass is the whole point of the
    // default-deny switch, so reading real decorator metadata is what needs asserting.
    guard = new JwtAuthGuard(jwtService, configService, new Reflector());
  });

  it('allows a valid token and attaches the payload to the request', async () => {
    const token = jwtService.sign({ username: 'admin', sub: 1 });
    const { context, request } = contextFor(`Bearer ${token}`);

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(request.user).toMatchObject({ username: 'admin', sub: 1 });
  });

  it('rejects a request with no Authorization header', async () => {
    const { context } = contextFor(undefined);
    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('rejects a non-Bearer scheme', async () => {
    const token = jwtService.sign({ username: 'admin', sub: 1 });
    const { context } = contextFor(`Basic ${token}`);
    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('rejects a malformed token', async () => {
    const { context } = contextFor('Bearer not-a-jwt');
    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('rejects an expired token', async () => {
    const token = jwtService.sign({ username: 'admin', sub: 1 }, { expiresIn: '-1s' });
    const { context } = contextFor(`Bearer ${token}`);
    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('rejects a token signed with a different secret', async () => {
    const attacker = new JwtService({ secret: 'a-completely-different-secret-value-32+' });
    const token = attacker.sign({ username: 'admin', sub: 1 });
    const { context } = contextFor(`Bearer ${token}`);
    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  // Regression guard, not proof of the algorithms: ['HS256'] pin — jsonwebtoken already
  // infers HS* from a string secret, so this token is rejected with or without it.
  it('rejects an unsigned alg:none token', async () => {
    const b64 = (obj: object) => Buffer.from(JSON.stringify(obj)).toString('base64url');
    const token = `${b64({ alg: 'none', typ: 'JWT' })}.${b64({ username: 'admin', sub: 1 })}.`;
    const { context } = contextFor(`Bearer ${token}`);
    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('lets a @Public() route through with no token at all', async () => {
    const { context } = contextFor(undefined, GuardedController.prototype.publicRoute);
    await expect(guard.canActivate(context)).resolves.toBe(true);
  });
});
