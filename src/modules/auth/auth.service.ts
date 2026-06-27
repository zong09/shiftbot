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
      const password = this.configService.get<string>('admin.password') || 'admin1234';

      const salt = await bcrypt.genSalt(10);
      const passwordHash = await bcrypt.hash(password, salt);

      const admin = this.userRepo.create({
        username,
        passwordHash,
      });
      await this.userRepo.save(admin);

      this.logger.log(`[Auth] No users found in database. Seeded admin user: "${username}"`);
      if (password === 'admin1234') {
        this.logger.warn(`[Auth] ⚠️ WARNING: Admin password is using the default 'admin1234'. Please change it in your environment configurations!`);
      }
    }
  }

  async validateUser(username: string, pass: string): Promise<any> {
    const user = await this.userRepo.findOne({ where: { username } });
    if (user && (await bcrypt.compare(pass, user.passwordHash))) {
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
