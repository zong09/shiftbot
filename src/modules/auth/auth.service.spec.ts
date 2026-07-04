import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { UnauthorizedException } from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { AuthService } from './auth.service';
import { UserEntity } from '../../database/entities/user.entity';

describe('AuthService', () => {
  let service: AuthService;
  let userRepo: any;
  let jwtService: any;
  let configService: any;

  const mockUser = {
    id: 1,
    username: 'admin',
    passwordHash: 'hashed_password',
  };

  beforeEach(async () => {
    userRepo = {
      count: jest.fn(),
      create: jest.fn().mockReturnValue(mockUser),
      save: jest.fn(),
      findOne: jest.fn(),
    };

    jwtService = {
      sign: jest.fn().mockReturnValue('mocked_jwt_token'),
    };

    configService = {
      get: jest.fn((key: string) => {
        if (key === 'admin.username') return 'admin';
        if (key === 'admin.password') return 'strong-test-password';
        return null;
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: getRepositoryToken(UserEntity), useValue: userRepo },
        { provide: JwtService, useValue: jwtService },
        { provide: ConfigService, useValue: configService },
      ],
    }).compile();

    service = module.get<AuthService>(AuthService);
  });

  describe('onApplicationBootstrap', () => {
    it('seeds admin user if no users exist', async () => {
      userRepo.count.mockResolvedValue(0);
      const hashSpy = jest.spyOn(bcrypt, 'hash').mockImplementation(() => Promise.resolve('hashed_password'));

      await service.onApplicationBootstrap();

      expect(userRepo.count).toHaveBeenCalled();
      expect(userRepo.create).toHaveBeenCalledWith({
        username: 'admin',
        passwordHash: 'hashed_password',
      });
      expect(userRepo.save).toHaveBeenCalled();
      hashSpy.mockRestore();
    });

    it('throws when seeding with a missing or default ADMIN_PASSWORD', async () => {
      userRepo.count.mockResolvedValue(0);
      configService.get.mockImplementation((key: string) => {
        if (key === 'admin.username') return 'admin';
        if (key === 'admin.password') return 'admin1234';
        return null;
      });

      await expect(service.onApplicationBootstrap()).rejects.toThrow(/ADMIN_PASSWORD/);
      expect(userRepo.save).not.toHaveBeenCalled();
    });

    it('does not seed admin user if users already exist', async () => {
      userRepo.count.mockResolvedValue(1);

      await service.onApplicationBootstrap();

      expect(userRepo.count).toHaveBeenCalled();
      expect(userRepo.create).not.toHaveBeenCalled();
      expect(userRepo.save).not.toHaveBeenCalled();
    });
  });

  describe('validateUser', () => {
    it('returns user details on valid username and password', async () => {
      userRepo.findOne.mockResolvedValue(mockUser);
      const compareSpy = jest.spyOn(bcrypt, 'compare').mockImplementation(() => Promise.resolve(true));

      const result = await service.validateUser('admin', 'admin1234');

      expect(userRepo.findOne).toHaveBeenCalledWith({ where: { username: 'admin' } });
      expect(result).toEqual({ id: 1, username: 'admin' });
      compareSpy.mockRestore();
    });

    it('returns null on invalid password', async () => {
      userRepo.findOne.mockResolvedValue(mockUser);
      const compareSpy = jest.spyOn(bcrypt, 'compare').mockImplementation(() => Promise.resolve(false));

      const result = await service.validateUser('admin', 'wrong_pass');

      expect(result).toBeNull();
      compareSpy.mockRestore();
    });

    it('returns null if user does not exist', async () => {
      userRepo.findOne.mockResolvedValue(null);

      const result = await service.validateUser('not_found', 'pass');

      expect(result).toBeNull();
    });
  });

  describe('login', () => {
    it('returns accessToken on successful validation', async () => {
      userRepo.findOne.mockResolvedValue(mockUser);
      jest.spyOn(bcrypt, 'compare').mockImplementation(() => Promise.resolve(true));

      const result = await service.login('admin', 'admin1234');

      expect(jwtService.sign).toHaveBeenCalledWith({ username: 'admin', sub: 1 });
      expect(result).toEqual({ accessToken: 'mocked_jwt_token' });
    });

    it('throws UnauthorizedException on invalid credentials', async () => {
      userRepo.findOne.mockResolvedValue(null);

      await expect(service.login('admin', 'wrong_pass')).rejects.toThrow(
        UnauthorizedException,
      );
    });
  });
});
