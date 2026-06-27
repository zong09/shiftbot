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
    host:     process.env.DB_HOST || 'localhost',
    port:     parseInt(process.env.DB_PORT, 10) || 5432,
    user:     process.env.DB_USER || 'shiftbot',
    password: process.env.DB_PASSWORD || 'shiftbot',
    name:     process.env.DB_NAME || 'shiftbot',
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
