import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ConfigService } from '@nestjs/config';
import { NotFoundException } from '@nestjs/common';
import { NotificationSettingsService } from './notification-settings.service';
import { NotificationSettingsEntity } from '../../database/entities/notification-settings.entity';
import { decrypt, encrypt } from '../../common/crypto.util';

const TEST_KEY = 'b'.repeat(64);

function makeRepo() {
  return {
    findOne: jest.fn(),
    upsert:  jest.fn().mockResolvedValue(undefined),
    update:  jest.fn().mockResolvedValue({ affected: 1 }),
  };
}

function makeConfigService(): jest.Mocked<Partial<ConfigService>> {
  return {
    get: jest.fn().mockReturnValue(TEST_KEY),
  } as any;
}

describe('NotificationSettingsService', () => {
  let service: NotificationSettingsService;
  let repo: ReturnType<typeof makeRepo>;

  beforeEach(async () => {
    repo = makeRepo();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        NotificationSettingsService,
        { provide: getRepositoryToken(NotificationSettingsEntity), useValue: repo },
        { provide: ConfigService, useValue: makeConfigService() },
      ],
    }).compile();
    service = module.get(NotificationSettingsService);
  });

  describe('getSettings()', () => {
    it('returns the existing row without creating one', async () => {
      const row = { mode: 'live' };
      repo.findOne.mockResolvedValue(row);
      const result = await service.getSettings('live');
      expect(result).toBe(row);
      expect(repo.upsert).not.toHaveBeenCalled();
    });

    it('upserts defaults when the row is missing', async () => {
      repo.findOne.mockResolvedValueOnce(null).mockResolvedValueOnce({ mode: 'sandbox' });
      await service.getSettings('sandbox');
      expect(repo.upsert).toHaveBeenCalledWith({ mode: 'sandbox' }, ['mode']);
    });
  });

  describe('toMaskedDto() / getMaskedSettings()', () => {
    it('returns null lineChannelAccessToken when none is stored', async () => {
      repo.findOne.mockResolvedValue({ mode: 'live', lineChannelAccessTokenEnc: null });
      const result = await service.getMaskedSettings('live');
      expect(result.lineChannelAccessToken).toBeNull();
      expect(result).not.toHaveProperty('lineChannelAccessTokenEnc');
    });

    it('masks a stored token — never returns the raw value', async () => {
      const raw = '8Ff2QmXQm9CQm9CQm9CQm9CQm9CQm9CwQ8f';
      repo.findOne.mockResolvedValue({ mode: 'live', lineChannelAccessTokenEnc: encrypt(raw, TEST_KEY) });
      const result = await service.getMaskedSettings('live');
      expect(result.lineChannelAccessToken).not.toBe(raw);
      expect(result.lineChannelAccessToken).toMatch(/^8Ff2•+8f$/);
      expect(JSON.stringify(result)).not.toContain(raw);
    });

    it('masks the stored channel secret too — never returns the raw value', async () => {
      const raw = 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6';
      repo.findOne.mockResolvedValue({ mode: 'live', lineChannelSecretEnc: encrypt(raw, TEST_KEY) });
      const result = await service.getMaskedSettings('live');
      expect(result.lineChannelSecret).not.toBe(raw);
      expect(result).not.toHaveProperty('lineChannelSecretEnc');
      expect(JSON.stringify(result)).not.toContain(raw);
    });

    it('returns null lineChannelAccessToken instead of throwing when stored ciphertext was encrypted under a different key (e.g. TOKEN_ENCRYPTION_KEY rotated)', async () => {
      const otherKey = 'c'.repeat(64);
      repo.findOne.mockResolvedValue({ mode: 'live', lineChannelAccessTokenEnc: encrypt('some-token', otherKey) });
      const result = await service.getMaskedSettings('live');
      expect(result.lineChannelAccessToken).toBeNull();
    });

    it('masks the stored Telegram bot token too — never returns the raw value', async () => {
      const raw = '7712345678:AAF9abcdefghijklmnopqrstuvwxyz01';
      repo.findOne.mockResolvedValue({ mode: 'live', telegramBotTokenEnc: encrypt(raw, TEST_KEY) });
      const result = await service.getMaskedSettings('live');
      expect(result.telegramBotToken).not.toBe(raw);
      expect(result.telegramBotToken).toMatch(/^7712•+01$/);
      expect(result).not.toHaveProperty('telegramBotTokenEnc');
      expect(JSON.stringify(result)).not.toContain(raw);
    });

    it('returns null telegramBotToken when none is stored', async () => {
      repo.findOne.mockResolvedValue({ mode: 'live', telegramBotTokenEnc: null });
      expect((await service.getMaskedSettings('live')).telegramBotToken).toBeNull();
    });
  });

  describe('getDecryptedTelegramToken()', () => {
    it('returns null when no bot token is stored', async () => {
      repo.findOne.mockResolvedValue({ mode: 'live', telegramBotTokenEnc: null });
      expect(await service.getDecryptedTelegramToken('live')).toBeNull();
    });

    it('decrypts the stored bot token back to its raw value', async () => {
      const raw = '7712345678:my-real-bot-token';
      repo.findOne.mockResolvedValue({ mode: 'live', telegramBotTokenEnc: encrypt(raw, TEST_KEY) });
      expect(await service.getDecryptedTelegramToken('live')).toBe(raw);
    });

    it('throws a clear, actionable error when the stored bot token cannot be decrypted with the current key', async () => {
      const otherKey = 'c'.repeat(64);
      repo.findOne.mockResolvedValue({ mode: 'live', telegramBotTokenEnc: encrypt('some-token', otherKey) });
      await expect(service.getDecryptedTelegramToken('live')).rejects.toThrow(/unreadable/);
    });
  });

  describe('getDecryptedToken()', () => {
    it('returns null when no token is stored', async () => {
      repo.findOne.mockResolvedValue({ mode: 'live', lineChannelAccessTokenEnc: null });
      expect(await service.getDecryptedToken('live')).toBeNull();
    });

    it('decrypts the stored token back to its raw value', async () => {
      const raw = 'my-real-line-token';
      repo.findOne.mockResolvedValue({ mode: 'live', lineChannelAccessTokenEnc: encrypt(raw, TEST_KEY) });
      expect(await service.getDecryptedToken('live')).toBe(raw);
    });

    it('throws a clear, actionable error when the stored token cannot be decrypted with the current key', async () => {
      const otherKey = 'c'.repeat(64);
      repo.findOne.mockResolvedValue({ mode: 'live', lineChannelAccessTokenEnc: encrypt('some-token', otherKey) });
      await expect(service.getDecryptedToken('live')).rejects.toThrow(/unreadable/);
    });
  });

  describe('getDecryptedChannelSecret()', () => {
    it('returns null when no channel secret is stored', async () => {
      repo.findOne.mockResolvedValue({ mode: 'live', lineChannelSecretEnc: null });
      expect(await service.getDecryptedChannelSecret('live')).toBeNull();
    });

    it('decrypts the stored channel secret back to its raw value', async () => {
      const raw = 'my-real-channel-secret';
      repo.findOne.mockResolvedValue({ mode: 'live', lineChannelSecretEnc: encrypt(raw, TEST_KEY) });
      expect(await service.getDecryptedChannelSecret('live')).toBe(raw);
    });

    it('returns null instead of throwing when the secret cannot be decrypted — the webhook must answer 401, not 500', async () => {
      const otherKey = 'c'.repeat(64);
      repo.findOne.mockResolvedValue({ mode: 'live', lineChannelSecretEnc: encrypt('s', otherKey) });
      expect(await service.getDecryptedChannelSecret('live')).toBeNull();
    });
  });

  describe('updateSettings()', () => {
    it('throws NotFoundException when the mode row does not exist', async () => {
      repo.findOne.mockResolvedValue(null);
      await expect(service.updateSettings('live', { lineEnabled: true })).rejects.toThrow(NotFoundException);
    });

    it('encrypts a newly-provided token before writing it', async () => {
      repo.findOne.mockResolvedValueOnce({ mode: 'live' }).mockResolvedValue({ mode: 'live', lineChannelAccessTokenEnc: null });
      await service.updateSettings('live', { lineChannelAccessToken: 'new-real-token' });
      const patch = repo.update.mock.calls[0][1];
      expect(patch.lineChannelAccessTokenEnc).toBeDefined();
      expect(patch.lineChannelAccessTokenEnc).not.toContain('new-real-token');
      expect(patch).not.toHaveProperty('lineChannelAccessToken');
    });

    it('leaves the stored token untouched when no new token is provided', async () => {
      repo.findOne.mockResolvedValueOnce({ mode: 'live' }).mockResolvedValue({ mode: 'live' });
      await service.updateSettings('live', { lineEnabled: true });
      const patch = repo.update.mock.calls[0][1];
      expect(patch).not.toHaveProperty('lineChannelAccessTokenEnc');
      expect(patch.lineEnabled).toBe(true);
    });

    it('encrypts a newly-provided channel secret before writing it', async () => {
      repo.findOne.mockResolvedValueOnce({ mode: 'live' }).mockResolvedValue({ mode: 'live', lineChannelSecretEnc: null });
      await service.updateSettings('live', { lineChannelSecret: 'new-real-secret' });
      const patch = repo.update.mock.calls[0][1];
      expect(patch.lineChannelSecretEnc).toBeDefined();
      expect(patch.lineChannelSecretEnc).not.toContain('new-real-secret');
      expect(patch).not.toHaveProperty('lineChannelSecret');
    });

    it('leaves the stored channel secret untouched when none is provided', async () => {
      repo.findOne.mockResolvedValueOnce({ mode: 'live' }).mockResolvedValue({ mode: 'live' });
      await service.updateSettings('live', { lineEnabled: true });
      expect(repo.update.mock.calls[0][1]).not.toHaveProperty('lineChannelSecretEnc');
    });

    // A trailing newline off the clipboard is invisible in the form and made LINE answer a
    // bare 401 with nothing to debug.
    it('trims whitespace pasted around a token before encrypting it', async () => {
      repo.findOne.mockResolvedValueOnce({ mode: 'live' }).mockResolvedValue({ mode: 'live', lineChannelAccessTokenEnc: null });
      await service.updateSettings('live', { lineChannelAccessToken: '  real-token\n' });
      expect(decrypt(repo.update.mock.calls[0][1].lineChannelAccessTokenEnc, TEST_KEY)).toBe('real-token');
    });

    it('trims pasted ids too, so a whitespace-only id is stored as empty', async () => {
      repo.findOne.mockResolvedValueOnce({ mode: 'live' }).mockResolvedValue({ mode: 'live' });
      await service.updateSettings('live', { lineGroupId: 'Cgroup123\n', lineUserId: '   ' });
      const patch = repo.update.mock.calls[0][1];
      expect(patch.lineGroupId).toBe('Cgroup123');
      expect(patch.lineUserId).toBe('');
    });

    // '\n'.trim() is falsy, so it must not overwrite a good stored secret with a blank one.
    it('treats a whitespace-only secret as absent and keeps the stored value', async () => {
      repo.findOne.mockResolvedValueOnce({ mode: 'live' }).mockResolvedValue({ mode: 'live' });
      await service.updateSettings('live', { lineChannelSecret: '  \n' });
      expect(repo.update.mock.calls[0][1]).not.toHaveProperty('lineChannelSecretEnc');
    });

    it('encrypts a newly-provided Telegram bot token before writing it', async () => {
      repo.findOne.mockResolvedValueOnce({ mode: 'live' }).mockResolvedValue({ mode: 'live', telegramBotTokenEnc: null });
      await service.updateSettings('live', { telegramBotToken: 'new-real-bot-token' });
      const patch = repo.update.mock.calls[0][1];
      expect(patch.telegramBotTokenEnc).toBeDefined();
      expect(patch.telegramBotTokenEnc).not.toContain('new-real-bot-token');
      expect(patch).not.toHaveProperty('telegramBotToken');
    });

    it('leaves the stored bot token untouched when none is provided', async () => {
      repo.findOne.mockResolvedValueOnce({ mode: 'live' }).mockResolvedValue({ mode: 'live' });
      await service.updateSettings('live', { telegramEnabled: true });
      const patch = repo.update.mock.calls[0][1];
      expect(patch).not.toHaveProperty('telegramBotTokenEnc');
      expect(patch.telegramEnabled).toBe(true);
    });
  });

  describe('markSent()', () => {
    it('stamps lastSentAt for the LINE channel', async () => {
      repo.findOne.mockResolvedValue({ mode: 'live' });
      await service.markSent('live', 'line');
      expect(repo.update.mock.calls[0][1]).toHaveProperty('lastSentAt');
    });

    it('stamps telegramLastSentAt for the Telegram channel — not LINE\'s', async () => {
      repo.findOne.mockResolvedValue({ mode: 'live' });
      await service.markSent('live', 'telegram');
      const patch = repo.update.mock.calls[0][1];
      expect(patch).toHaveProperty('telegramLastSentAt');
      expect(patch).not.toHaveProperty('lastSentAt');
    });
  });
});
