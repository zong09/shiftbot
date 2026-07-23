import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { NotFoundException } from '@nestjs/common';
import { TradingSettingsService } from './trading-settings.service';
import { TradingSettingsEntity } from '../../database/entities/trading-settings.entity';

function makeRepo() {
  return {
    findOne: jest.fn(),
    find:    jest.fn(),
    create:  jest.fn((dto) => dto),
    save:    jest.fn((e) => Promise.resolve(e)),
    upsert:  jest.fn().mockResolvedValue(undefined),
    update:  jest.fn().mockResolvedValue({ affected: 1 }),
    delete:  jest.fn().mockResolvedValue(undefined),
  };
}

describe('TradingSettingsService', () => {
  let service: TradingSettingsService;
  let repo: ReturnType<typeof makeRepo>;

  beforeEach(async () => {
    repo = makeRepo();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TradingSettingsService,
        { provide: getRepositoryToken(TradingSettingsEntity), useValue: repo },
      ],
    }).compile();
    service = module.get(TradingSettingsService);
  });

  describe('getSettings()', () => {
    it('returns the existing row without creating one', async () => {
      const row = { mode: 'live', symbol: 'BTC/USDT:USDT' };
      repo.findOne.mockResolvedValue(row);
      const result = await service.getSettings('live', 'BTC/USDT:USDT');
      expect(result).toBe(row);
      expect(repo.upsert).not.toHaveBeenCalled();
    });

    it('creates defaults via upsert (not save) when the row is missing, avoiding a PK race', async () => {
      const created = { mode: 'live', symbol: 'ETH/USDT:USDT' };
      repo.findOne.mockResolvedValueOnce(null).mockResolvedValueOnce(created);
      const result = await service.getSettings('live', 'ETH/USDT:USDT');
      expect(repo.upsert).toHaveBeenCalledWith(
        expect.objectContaining({ mode: 'live', symbol: 'ETH/USDT:USDT' }),
        ['mode', 'symbol'],
      );
      expect(repo.save).not.toHaveBeenCalled();
      expect(result).toBe(created);
    });
  });

  describe('updateSettings()', () => {
    it('throws NotFoundException for a pair that was never added (no phantom row)', async () => {
      repo.findOne.mockResolvedValue(null);
      await expect(
        service.updateSettings('live', 'DOGE/USDT:USDT', { leverage: 3 }),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(repo.update).not.toHaveBeenCalled();
      expect(repo.upsert).not.toHaveBeenCalled();
    });

    it('updates an existing pair via update (not upsert)', async () => {
      const existing = { mode: 'live', symbol: 'BTC/USDT:USDT', leverage: 5 };
      repo.findOne.mockResolvedValue(existing);
      await service.updateSettings('live', 'BTC/USDT:USDT', { leverage: 3 });
      expect(repo.update).toHaveBeenCalledWith(
        { mode: 'live', symbol: 'BTC/USDT:USDT' },
        { leverage: 3 },
      );
    });
  });
});
