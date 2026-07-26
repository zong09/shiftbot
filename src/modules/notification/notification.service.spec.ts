import { Test, TestingModule } from '@nestjs/testing';
import axios from 'axios';
import { NotificationService } from './notification.service';
import { NotificationSettingsService } from '../notification-settings/notification-settings.service';
import { NotificationSettingsEntity } from '../../database/entities/notification-settings.entity';
import { Position } from '../../common/types';

jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

const LINE_PUSH = 'https://api.line.me/v2/bot/message/push';

/** A fully-configured row; each test switches off only what it's testing. */
function settings(overrides: Partial<NotificationSettingsEntity> = {}): NotificationSettingsEntity {
  return {
    mode: 'live',
    lineEnabled: true,
    lineWebhookUrl: null,
    lineChannelAccessTokenEnc: 'enc',
    lineChannelSecretEnc: null,
    lineGroupId: 'Cgroup123',
    lineUserId: null,
    notifyOpen: true,
    notifyClose: true,
    notifyTpSl: true,
    notifyError: true,
    notifyDailySummary: false,
    lastSentAt: null,
    telegramEnabled: true,
    telegramBotTokenEnc: 'enc',
    telegramChatId: '-1001234567890',
    telegramMessageThreadId: null,
    telegramNotifyOpen: true,
    telegramNotifyClose: true,
    telegramNotifyTpSl: true,
    telegramNotifyError: true,
    telegramNotifyDailySummary: false,
    telegramLastSentAt: null,
    ...overrides,
  };
}

const position = {
  symbol: 'BTC/USDT:USDT',
  side: 'long',
  entryPrice: 50_000,
  quantity: 0.01,
  stopLoss: 49_000,
  takeProfit: 52_000,
  closedPnl: 12.5,
} as Position;

/** URLs of every axios.post made, in call order. */
const postedUrls = () => mockedAxios.post.mock.calls.map(c => c[0] as string);
const bodyFor = (url: string) =>
  mockedAxios.post.mock.calls.find(c => (c[0] as string).includes(url))?.[1] as any;

describe('NotificationService', () => {
  let service: NotificationService;
  let settingsSvc: jest.Mocked<Partial<NotificationSettingsService>>;

  beforeEach(async () => {
    jest.clearAllMocks();
    mockedAxios.post.mockResolvedValue({ data: {} } as any);
    settingsSvc = {
      getSettings: jest.fn().mockResolvedValue(settings()),
      getDecryptedToken: jest.fn().mockResolvedValue('line-token'),
      getDecryptedTelegramToken: jest.fn().mockResolvedValue('123:bot-token'),
    } as any;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        NotificationService,
        { provide: NotificationSettingsService, useValue: settingsSvc },
      ],
    }).compile();
    service = module.get(NotificationService);
  });

  describe('channel fan-out', () => {
    it('sends to both channels when both are enabled', async () => {
      await service.sendOpenPosition(position, 'live');
      const urls = postedUrls();
      expect(urls).toHaveLength(2);
      expect(urls).toContain(LINE_PUSH);
      expect(urls.some(u => u.startsWith('https://api.telegram.org/bot'))).toBe(true);
    });

    it('sends only to LINE when Telegram is disabled', async () => {
      (settingsSvc.getSettings as jest.Mock).mockResolvedValue(settings({ telegramEnabled: false }));
      await service.sendOpenPosition(position, 'live');
      expect(postedUrls()).toEqual([LINE_PUSH]);
    });

    it('sends only to Telegram when LINE is disabled', async () => {
      (settingsSvc.getSettings as jest.Mock).mockResolvedValue(settings({ lineEnabled: false }));
      await service.sendOpenPosition(position, 'live');
      expect(postedUrls()).toHaveLength(1);
      expect(postedUrls()[0]).toContain('api.telegram.org');
    });

    it('sends nothing when both channels are disabled', async () => {
      (settingsSvc.getSettings as jest.Mock).mockResolvedValue(
        settings({ lineEnabled: false, telegramEnabled: false }),
      );
      await service.sendOpenPosition(position, 'live');
      expect(mockedAxios.post).not.toHaveBeenCalled();
    });

    // The regression this whole refactor exists to prevent: NOTIFY_CHANNEL used to gate
    // both channels globally, so one misconfigured channel silenced the other.
    it('still sends on LINE when the Telegram token is unreadable', async () => {
      (settingsSvc.getDecryptedTelegramToken as jest.Mock).mockRejectedValue(new Error('unreadable'));
      await service.sendOpenPosition(position, 'live');
      expect(postedUrls()).toEqual([LINE_PUSH]);
    });

    it('still sends on Telegram when the LINE push fails', async () => {
      mockedAxios.post.mockImplementation(async (url: string) => {
        if (url === LINE_PUSH) throw new Error('LINE 429');
        return { data: {} } as any;
      });
      await service.sendOpenPosition(position, 'live');
      expect(postedUrls().filter(u => u.includes('api.telegram.org'))).toHaveLength(1);
    });
  });

  describe('per-channel event flags', () => {
    it('skips the channel whose own flag is off and still sends on the other', async () => {
      (settingsSvc.getSettings as jest.Mock).mockResolvedValue(settings({ telegramNotifyOpen: false }));
      await service.sendOpenPosition(position, 'live');
      expect(postedUrls()).toEqual([LINE_PUSH]);
    });

    it('routes an SL close through the tpsl flag, not the close flag', async () => {
      (settingsSvc.getSettings as jest.Mock).mockResolvedValue(
        settings({ notifyTpSl: false, telegramNotifyTpSl: false, notifyClose: true, telegramNotifyClose: true }),
      );
      await service.sendClosePosition(position, 'SL', 49_000, 'live');
      expect(mockedAxios.post).not.toHaveBeenCalled();
    });

    it('routes a signal close through the close flag', async () => {
      (settingsSvc.getSettings as jest.Mock).mockResolvedValue(
        settings({ notifyClose: false, telegramNotifyClose: false }),
      );
      await service.sendClosePosition(position, 'SIGNAL', 51_000, 'live');
      expect(mockedAxios.post).not.toHaveBeenCalled();
    });

    it('gates errors on the error flag per channel', async () => {
      (settingsSvc.getSettings as jest.Mock).mockResolvedValue(settings({ notifyError: false }));
      await service.sendError('order rejected', 'live');
      expect(postedUrls()).toHaveLength(1);
      expect(postedUrls()[0]).toContain('api.telegram.org');
    });
  });

  describe('message shaping', () => {
    it('keeps Markdown for Telegram and strips it for LINE', async () => {
      await service.sendError('boom', 'live');
      expect(bodyFor('api.telegram.org').text).toContain('*Bot Error*');
      expect(bodyFor(LINE_PUSH).messages[0].text).not.toContain('*');
    });

    it('omits message_thread_id unless one is configured', async () => {
      await service.sendOpenPosition(position, 'live');
      expect(bodyFor('api.telegram.org')).not.toHaveProperty('message_thread_id');
    });

    it('includes message_thread_id when configured', async () => {
      (settingsSvc.getSettings as jest.Mock).mockResolvedValue(settings({ telegramMessageThreadId: '42' }));
      await service.sendOpenPosition(position, 'live');
      expect(bodyFor('api.telegram.org').message_thread_id).toBe('42');
    });

    it('targets telegramChatId', async () => {
      await service.sendOpenPosition(position, 'live');
      expect(bodyFor('api.telegram.org').chat_id).toBe('-1001234567890');
    });
  });

  describe('sendTest()', () => {
    it('sends only the requested channel and reports success', async () => {
      await expect(service.sendTest('live', 'telegram')).resolves.toBe(true);
      expect(postedUrls()).toHaveLength(1);
      expect(postedUrls()[0]).toContain('api.telegram.org');
    });

    // The panel stays editable while the channel is off, so the button must work there.
    it('sends even when the channel is disabled', async () => {
      (settingsSvc.getSettings as jest.Mock).mockResolvedValue(settings({ telegramEnabled: false }));
      await expect(service.sendTest('live', 'telegram')).resolves.toBe(true);
    });

    it('bypasses the per-event flags', async () => {
      (settingsSvc.getSettings as jest.Mock).mockResolvedValue(
        settings({ notifyOpen: false, notifyClose: false, notifyTpSl: false, notifyError: false }),
      );
      await expect(service.sendTest('live', 'line')).resolves.toBe(true);
    });

    it('reports false without sending when the channel has no credentials', async () => {
      (settingsSvc.getSettings as jest.Mock).mockResolvedValue(settings({ telegramChatId: null }));
      await expect(service.sendTest('live', 'telegram')).resolves.toBe(false);
      expect(mockedAxios.post).not.toHaveBeenCalled();
    });

    // A bare "Request failed with status code 401" says nothing about which credential is
    // wrong — the reason LINE returns in the body has to reach the dashboard.
    it('surfaces the provider reason when the send fails', async () => {
      mockedAxios.post.mockRejectedValue({
        message: 'Request failed with status code 401',
        response: { data: { message: 'Authentication failed due to an invalid access token' } },
      });
      await expect(service.sendTest('live', 'line')).rejects.toThrow(/invalid access token/);
    });

    it('reports false when LINE has no push target', async () => {
      (settingsSvc.getSettings as jest.Mock).mockResolvedValue(
        settings({ lineGroupId: null, lineUserId: null }),
      );
      await expect(service.sendTest('live', 'line')).resolves.toBe(false);
    });
  });
});
