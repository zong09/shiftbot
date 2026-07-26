import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ConfigService } from '@nestjs/config';
import { NotFoundException } from '@nestjs/common';
import { NotificationSettingsService } from './notification-settings.service';
import { NotificationSettingsEntity } from '../../database/entities/notification-settings.entity';
import { encrypt } from '../../common/crypto.util';

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
  });

  describe('updateSettings()', () => {
    it('throws NotFoundException when the mode row does not exist', async () => {
      repo.findOne.mockResolvedValue(null);
      await expect(service.updateSettings('live', { enabled: true })).rejects.toThrow(NotFoundException);
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
      await service.updateSettings('live', { enabled: true });
      const patch = repo.update.mock.calls[0][1];
      expect(patch).not.toHaveProperty('lineChannelAccessTokenEnc');
      expect(patch.enabled).toBe(true);
    });
  });
});
