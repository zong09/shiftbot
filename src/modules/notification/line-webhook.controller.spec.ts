import { Test, TestingModule } from '@nestjs/testing';
import { UnauthorizedException } from '@nestjs/common';
import { createHmac } from 'crypto';
import { LineWebhookController, verifyLineSignature } from './line-webhook.controller';
import { NotificationService } from './notification.service';
import { NotificationSettingsService } from '../notification-settings/notification-settings.service';

const SECRET = 'test_channel_secret';
const sign = (raw: Buffer | string) =>
  createHmac('sha256', SECRET).update(raw).digest('base64');

describe('verifyLineSignature', () => {
  const raw = Buffer.from(JSON.stringify({ destination: 'U1', events: [] }));

  it('ผ่านเมื่อ signature ตรงกับ raw body', () => {
    expect(verifyLineSignature(raw, sign(raw), SECRET)).toBe(true);
  });

  it('ไม่ผ่านเมื่อ body ถูกแก้หลังเซ็น', () => {
    const tampered = Buffer.from(JSON.stringify({ destination: 'U2', events: [] }));
    expect(verifyLineSignature(tampered, sign(raw), SECRET)).toBe(false);
  });

  it('ไม่ผ่านเมื่อ signature ความยาวไม่ตรง (ไม่ throw)', () => {
    expect(verifyLineSignature(raw, Buffer.from('short').toString('base64'), SECRET)).toBe(false);
  });

  it('ไม่ผ่านเมื่อไม่มี rawBody / signature / secret', () => {
    expect(verifyLineSignature(undefined, sign(raw), SECRET)).toBe(false);
    expect(verifyLineSignature(raw, undefined, SECRET)).toBe(false);
    expect(verifyLineSignature(raw, sign(raw), null)).toBe(false);
  });
});

describe('LineWebhookController', () => {
  let controller: LineWebhookController;
  let notificationService: any;
  let notificationSettingsService: any;

  beforeEach(async () => {
    notificationService = { replyLine: jest.fn() };
    notificationSettingsService = {
      getDecryptedChannelSecret: jest.fn().mockResolvedValue(SECRET),
    };
    const module: TestingModule = await Test.createTestingModule({
      controllers: [LineWebhookController],
      providers: [
        { provide: NotificationService, useValue: notificationService },
        { provide: NotificationSettingsService, useValue: notificationSettingsService },
      ],
    }).compile();
    controller = module.get<LineWebhookController>(LineWebhookController);
  });

  const post = (payload: object, opts: { signature?: string; mode?: 'live' | 'sandbox' } = {}) => {
    const raw = Buffer.from(JSON.stringify(payload));
    return controller.handleWebhook(
      opts.mode ?? 'sandbox',
      { rawBody: raw } as any,
      opts.signature ?? sign(raw),
      payload as any,
    );
  };

  it('ตอบ 200 ให้ payload ว่างของปุ่ม Verify', async () => {
    await expect(post({ destination: 'U1', events: [] })).resolves.toEqual({ ok: true });
  });

  it('ปฏิเสธเมื่อ signature ผิด', async () => {
    await expect(post({ events: [] }, { signature: sign('other') })).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it('ปฏิเสธเมื่อ mode นั้นยังไม่ได้ตั้ง channel secret', async () => {
    notificationSettingsService.getDecryptedChannelSecret.mockResolvedValue(null);
    await expect(post({ events: [] })).rejects.toThrow(UnauthorizedException);
  });

  it('ใช้ secret ของ mode ที่อยู่ใน URL', async () => {
    await post({ events: [] }, { mode: 'live' });
    expect(notificationSettingsService.getDecryptedChannelSecret).toHaveBeenCalledWith('live');
  });

  it('ตอบ groupId กลับเข้ากลุ่มเมื่อบอทถูกเชิญเข้ามา (join)', async () => {
    await post({
      events: [
        { type: 'join', replyToken: 'rt-1', source: { type: 'group', groupId: 'Cgroup123' } },
      ],
    });
    expect(notificationService.replyLine).toHaveBeenCalledWith(
      'sandbox',
      'rt-1',
      expect.stringContaining('Cgroup123'),
    );
  });

  it('ไม่ตอบกลับเมื่อเป็น event ธรรมดา', async () => {
    await post({
      events: [
        { type: 'message', replyToken: 'rt-2', source: { type: 'group', groupId: 'Cgroup123' } },
      ],
    });
    expect(notificationService.replyLine).not.toHaveBeenCalled();
  });

  it('ยังตอบ 200 แม้ตอบกลับ LINE ไม่สำเร็จ (LINE จะได้ไม่ retry)', async () => {
    notificationService.replyLine.mockRejectedValue(new Error('token unreadable'));
    await expect(
      post({
        events: [
          { type: 'join', replyToken: 'rt-3', source: { type: 'group', groupId: 'Cgroup123' } },
        ],
      }),
    ).resolves.toEqual({ ok: true });
  });
});
