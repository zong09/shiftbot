import { Module, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { createHmac } from 'crypto';
import { LineWebhookController } from './line-webhook.controller';
import { NotificationService } from './notification.service';
import { NotificationSettingsService } from '../notification-settings/notification-settings.service';

/**
 * Boots a real HTTP server to lock down two wiring details that unit tests can't see
 * and that fail silently if broken:
 *   1. `rawBody: true` in main.ts actually populates `req.rawBody` (without it every
 *      signature check fails, since HMAC must run over LINE's exact bytes).
 *   2. The global ValidationPipe (whitelist + forbidNonWhitelisted) lets LINE's payload
 *      through to `@Body() body: any` instead of rejecting it with 400.
 */

const SECRET = 'rawbody_spec_secret';
const replyLine = jest.fn();

@Module({
  controllers: [LineWebhookController],
  providers: [
    { provide: NotificationService, useValue: { replyLine } },
    {
      provide: NotificationSettingsService,
      useValue: { getDecryptedChannelSecret: async () => SECRET },
    },
  ],
})
class RawBodyTestModule {}

describe('LINE webhook rawBody wiring', () => {
  let app: any;
  let url: string;

  beforeAll(async () => {
    app = await NestFactory.create(RawBodyTestModule, { rawBody: true, logger: false });
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
    );
    await app.listen(0);
    url = `${await app.getUrl()}/api/line/webhook/sandbox`.replace('[::1]', '127.0.0.1');
  });

  afterAll(async () => {
    await app?.close();
  });

  const payload = JSON.stringify({
    destination: 'Uxxx',
    events: [
      {
        type: 'join',
        mode: 'active',
        replyToken: 'rt',
        source: { type: 'group', groupId: 'Cgroup' },
      },
    ],
  });

  it('รับ POST ที่เซ็นถูกต้อง แล้วอ่าน source ออกมาได้', async () => {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-line-signature': createHmac('sha256', SECRET).update(payload).digest('base64'),
      },
      body: payload,
    });

    expect(res.status).toBe(200);
    expect(replyLine).toHaveBeenCalledWith('sandbox', 'rt', expect.stringContaining('Cgroup'));
  });

  it('ปฏิเสธ POST ที่ signature ไม่ถูกต้อง', async () => {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-line-signature': 'AAAA' },
      body: payload,
    });

    expect(res.status).toBe(401);
  });
});
