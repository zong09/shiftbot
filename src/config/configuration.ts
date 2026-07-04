const requireJwtSecret = (): string => {
  const secret = process.env.JWT_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error(
      '[Config] JWT_SECRET must be set and at least 32 characters long. ' +
        'Generate one with: openssl rand -hex 32',
    );
  }
  return secret;
};

export default () => ({
  port: parseInt(process.env.PORT, 10) || 3000,

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

  admin: {
    username: process.env.ADMIN_USERNAME || 'admin',
    password: process.env.ADMIN_PASSWORD,
  },

  database: {
    url:      process.env.DATABASE_URL,
    host:     process.env.DB_HOST || process.env.PGHOST || 'localhost',
    port:     parseInt(process.env.DB_PORT || process.env.PGPORT || '5432', 10),
    user:     process.env.DB_USER || process.env.PGUSER || 'shiftbot',
    password: process.env.DB_PASSWORD || process.env.PGPASSWORD || 'shiftbot',
    name:     process.env.DB_NAME || process.env.PGDATABASE || 'shiftbot',
  },

  notification: {
    channel: process.env.NOTIFY_CHANNEL || 'telegram',
    telegram: {
      botToken: process.env.TELEGRAM_BOT_TOKEN,
      chatId: process.env.TELEGRAM_CHAT_ID,
    },
    line: {
      token: process.env.LINE_NOTIFY_TOKEN,
    },
  },
});
