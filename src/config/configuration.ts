export default () => ({
  port: parseInt(process.env.PORT, 10) || 3000,

  binance: {
    apiKey: process.env.BINANCE_API_KEY,
    apiSecret: process.env.BINANCE_API_SECRET,
    testnet: process.env.BINANCE_TESTNET === 'true',
  },

  trading: {
    symbol: process.env.SYMBOL || 'BTC/USDT:USDT',
    timeframe: process.env.TIMEFRAME || '1h',
    leverage: parseInt(process.env.LEVERAGE, 10) || 5,
    orderSizeUsdt: parseFloat(process.env.ORDER_SIZE_USDT) || 100,
    maxPositions: parseInt(process.env.MAX_POSITIONS, 10) || 1,
  },

  indicator: {
    emaFast: parseInt(process.env.EMA_FAST, 10) || 12,
    emaSlow: parseInt(process.env.EMA_SLOW, 10) || 26,
  },

  riskManagement: {
    stopLossPct: parseFloat(process.env.STOP_LOSS_PCT) || 2.0,
    takeProfitPct: parseFloat(process.env.TAKE_PROFIT_PCT) || 4.0,
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
