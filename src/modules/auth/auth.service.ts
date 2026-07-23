import { Injectable, Logger, OnApplicationBootstrap, UnauthorizedException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcryptjs';
import { UserEntity } from '../../database/entities/user.entity';

@Injectable()
export class AuthService implements OnApplicationBootstrap {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    @InjectRepository(UserEntity)
    private userRepo: Repository<UserEntity>,
    private jwtService: JwtService,
    private configService: ConfigService,
  ) {}

  async onApplicationBootstrap() {
    await this.seedAdminUser();
  }

  private async seedAdminUser() {
    const userCount = await this.userRepo.count();
    if (userCount === 0) {
      const username = this.configService.get<string>('admin.username') || 'admin';
      const password = this.configService.get<string>('admin.password');

      if (!password || password === 'admin1234' || password.length < 8) {
        throw new Error(
          '[Auth] ADMIN_PASSWORD must be set to a non-default value of at least 8 characters before the first admin user can be seeded.',
        );
      }

      const salt = await bcrypt.genSalt(10);
      const passwordHash = await bcrypt.hash(password, salt);

      const admin = this.userRepo.create({
        username,
        passwordHash,
      });
      await this.userRepo.save(admin);

      this.logger.log(`[Auth] No users found in database. Seeded admin user: "${username}"`);
    } else if (this.configService.get<string>('admin.password') === 'admin1234') {
      this.logger.warn(
        `[Auth] ⚠️ ADMIN_PASSWORD in .env is still the default 'admin1234'. The seeded DB user may also use it — change the password.`,
      );
    }
  }

  // bcrypt hash of a throwaway value — compared against on the user-miss path so an
  // unknown username takes the same time as a wrong password (no timing enumeration).
  private static readonly DUMMY_HASH =
    '$2a$10$CwTycUXWue0Thq9StjUM0uJ8ZzKpXGiJT2rDCBBB0mPZEK1bZDHhu';

  async validateUser(username: string, pass: string): Promise<any> {
    const user = await this.userRepo.findOne({ where: { username } });
    if (!user) {
      await bcrypt.compare(pass, AuthService.DUMMY_HASH); // equalize timing
      return null;
    }
    if (await bcrypt.compare(pass, user.passwordHash)) {
      const { passwordHash, ...result } = user;
      return result;
    }
    return null;
  }

  async login(username: string, pass: string) {
    const user = await this.validateUser(username, pass);
    if (!user) {
      throw new UnauthorizedException('ชื่อผู้ใช้งานหรือรหัสผ่านไม่ถูกต้อง');
    }

    const payload = { username: user.username, sub: user.id };
    return {
      accessToken: this.jwtService.sign(payload),
    };
  }
}
