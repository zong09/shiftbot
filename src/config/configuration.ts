export default () => ({
  port: parseInt(process.env.PORT, 10) || 3000,

  binance: {
    apiKey:        process.env.BINANCE_API_KEY,
    apiSecret:     process.env.BINANCE_API_SECRET,
    demoApiKey:    process.env.BINANCE_DEMO_API_KEY,
    demoApiSecret: process.env.BINANCE_DEMO_API_SECRET,
  },

  jwt: {
    secret: process.env.JWT_SECRET || 'supersecretkey-shiftbot-change-me',
    expiry: process.env.JWT_EXPIRY || '24h',
  },

  admin: {
    username: process.env.ADMIN_USERNAME || 'admin',
    password: process.env.ADMIN_PASSWORD || 'admin1234',
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
