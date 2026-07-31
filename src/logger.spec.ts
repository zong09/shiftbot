import { redactSecrets } from './logger';

const SYNTHETIC_TOKEN = '123456:FAKE-not-a-real-telegram-token';

// The file transports keep 30 days of logs. Anything that reaches them is on disk for a
// month, so the redaction format is the thing that has to hold — not the discipline of
// every future call site.
describe('redactSecrets', () => {
  const run = (info: any) => redactSecrets().transform(info) as any;

  it('redacts values under secret-looking keys', () => {
    const out = run({
      level: 'error',
      message: 'send failed',
      telegramBotToken: SYNTHETIC_TOKEN,
      lineChannelSecret: 'shhh',
      password: 'hunter2',
      authorization: 'Bearer abc',
      apiKey: 'k',
      api_key: 'k',
    });

    expect(out.telegramBotToken).toBe('[REDACTED]');
    expect(out.lineChannelSecret).toBe('[REDACTED]');
    expect(out.password).toBe('[REDACTED]');
    expect(out.authorization).toBe('[REDACTED]');
    expect(out.apiKey).toBe('[REDACTED]');
    expect(out.api_key).toBe('[REDACTED]');
  });

  it('keeps ordinary fields intact', () => {
    const out = run({ level: 'log', message: 'opened long', mode: 'live', symbol: 'BTC/USDT:USDT' });
    expect(out.message).toBe('opened long');
    expect(out.mode).toBe('live');
    expect(out.symbol).toBe('BTC/USDT:USDT');
  });

  it('drops the axios request config, where the Telegram bot token hides in the URL', () => {
    const out = run({
      level: 'error',
      message: 'Request failed with status code 401',
      config: {
        url: `https://api.telegram.org/bot${SYNTHETIC_TOKEN}/sendMessage`,
        headers: { Authorization: `Bearer ${SYNTHETIC_TOKEN}` },
      },
      response: { data: { description: 'Unauthorized' } },
    });

    expect(out.config).toBeUndefined();
    expect(out.response).toBeUndefined();
    expect(JSON.stringify(out)).not.toContain(SYNTHETIC_TOKEN);
  });

  it('redacts inside nested objects and arrays', () => {
    const out = run({
      level: 'error',
      settings: { line: { lineChannelAccessToken: 'abc' } },
      attempts: [{ botToken: 'x' }, { botToken: 'y' }],
    });

    expect(out.settings.line.lineChannelAccessToken).toBe('[REDACTED]');
    expect(out.attempts[0].botToken).toBe('[REDACTED]');
    expect(out.attempts[1].botToken).toBe('[REDACTED]');
  });
});
