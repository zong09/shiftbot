import helmet from 'helmet';

/**
 * Security headers for every response, dashboard HTML included.
 *
 * Lives in its own module rather than inline in main.ts so a spec can boot a minimal app
 * with the *actual* config object — importing main.ts would run bootstrap() as a side
 * effect, and a copy of the directives in a test would prove nothing about what ships.
 */
export function securityHeaders(isProd: boolean) {
  return helmet({
    contentSecurityPolicy: {
      useDefaults: false,
      directives: {
        defaultSrc: ["'self'"],
        // No 'unsafe-inline' — the JWT lives in localStorage, so script execution on this
        // origin is a full account takeover. dashboard/index.html loads its theme
        // pre-paint from /theme-init.js instead of inlining it precisely to keep this
        // directive clean; re-inlining any script silently breaks the page.
        scriptSrc: ["'self'"],
        // React sets style attributes and Tailwind v4 injects a <style> tag. Does not
        // weaken script-src.
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", 'data:'],   // favicon is a data: URI
        fontSrc: ["'self'", 'data:'],  // @fontsource is bundled, not CDN-loaded
        connectSrc: ["'self'"],        // api.js BASE = '/api' — same-origin only
        objectSrc: ["'none'"],
        frameAncestors: ["'none'"],
        baseUri: ["'self'"],
        formAction: ["'self'"],
        ...(isProd ? { upgradeInsecureRequests: [] } : {}),
      },
    },
    // Production only — sending HSTS from a local http:// dev server would pin localhost
    // to https in the developer's browser for six months.
    hsts: isProd ? { maxAge: 15_552_000, includeSubDomains: true } : false,
  });
}
