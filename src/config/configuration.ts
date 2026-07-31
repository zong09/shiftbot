/**
 * Placeholders shipped in .env.example used to satisfy the length checks below —
 * `cp .env.example .env` produced a bootable app signing JWTs with a secret published
 * in the repo. Matching on the placeholder wording (rather than an exact string list)
 * catches both the current REPLACE_ME_* values and the older ones still sitting in
 * copied .env files.
 */
const PLACEHOLDER = /^replace_me|change_me|generate_with/i;

const rejectPlaceholder = (name: string, value: string): void => {
  if (PLACEHOLDER.test(value)) {
    throw new Error(
      `[Config] ${name} is still set to the .env.example placeholder. ` +
        'Replace it with a real value before booting.',
    );
  }
};

/**
 * NODE_ENV drives whether TypeORM auto-synchronizes the schema and whether DB SSL is on
 * (app.module.ts). Unset used to mean "not production", so a deployment that forgot to
 * set it would silently ALTER live trading tables over an unencrypted connection.
 * Fail closed instead. The dev/debug npm scripts set it explicitly; jest sets 'test'.
 */
const requireNodeEnv = (): string => {
  const env = process.env.NODE_ENV;
  if (env !== 'development' && env !== 'test' && env !== 'production') {
    throw new Error(
      `[Config] NODE_ENV must be set to 'development', 'test' or 'production' (got ${
        env ? `'${env}'` : 'unset'
      }). It decides whether the schema auto-syncs and whether DB SSL is enabled.`,
    );
  }
  return env;
};

const requireJwtSecret = (): string => {
  const secret = process.env.JWT_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error(
      '[Config] JWT_SECRET must be set and at least 32 characters long. ' +
        'Generate one with: openssl rand -hex 32',
    );
  }
  rejectPlaceholder('JWT_SECRET', secret);
  return secret;
};

/**
 * The dev default was `shiftbot`/`shiftbot`, matching docker-compose's own default — fine
 * locally, a publicly-guessable credential in production. Only production fails closed;
 * dev keeps the convenience default so `docker compose up -d && npm run dev` still works.
 */
const resolveDbPassword = (): string => {
  const password = process.env.DB_PASSWORD || process.env.PGPASSWORD;
  if (password) return password;
  if (process.env.NODE_ENV === 'production' && !process.env.DATABASE_URL) {
    throw new Error(
      '[Config] DB_PASSWORD (or DATABASE_URL) must be set in production — ' +
        'refusing to fall back to the default development password.',
    );
  }
  return 'shiftbot';
};

const requireTokenEncryptionKey = (): string => {
  const key = process.env.TOKEN_ENCRYPTION_KEY;
  if (!key || key.length !== 64 || !/^[0-9a-fA-F]{64}$/.test(key)) {
    throw new Error(
      '[Config] TOKEN_ENCRYPTION_KEY must be set as a 64-character hex string (32 bytes). ' +
        'Generate one with: openssl rand -hex 32',
    );
  }
  return key;
};

const requireAdminPassword = (): string | undefined => {
  const password = process.env.ADMIN_PASSWORD;
  // Absent is allowed here — AuthService only needs it when seeding the first user, and
  // rejects a weak one there. A placeholder, though, is never valid.
  if (password) rejectPlaceholder('ADMIN_PASSWORD', password);
  return password;
};

export default () => ({
  nodeEnv: requireNodeEnv(),
  port: parseInt(process.env.PORT, 10) || 3001,

  binance: {
    apiKey:        process.env.BINANCE_API_KEY,
    apiSecret:     process.env.BINANCE_API_SECRET,
    demoApiKey:    process.env.BINANCE_DEMO_API_KEY,
    demoApiSecret: process.env.BINANCE_DEMO_API_SECRET,
  },

  jwt: {
    secret: requireJwtSecret(),
    expiry: process.env.JWT_EXPIRY || '24h',
  },

  security: {
    tokenEncryptionKey: requireTokenEncryptionKey(),
  },

  admin: {
    username: process.env.ADMIN_USERNAME || 'admin',
    password: requireAdminPassword(),
  },

  database: {
    url:      process.env.DATABASE_URL,
    host:     process.env.DB_HOST || process.env.PGHOST || 'localhost',
    port:     parseInt(process.env.DB_PORT || process.env.PGPORT || '5432', 10),
    user:     process.env.DB_USER || process.env.PGUSER || 'shiftbot',
    password: resolveDbPassword(),
    name:     process.env.DB_NAME || process.env.PGDATABASE || 'shiftbot',
  },

  // Notification credentials are not env-configured — LINE and Telegram are both stored
  // per mode in notification_settings, with their secrets encrypted using
  // security.tokenEncryptionKey. Edit them in the dashboard's Settings page.
});
