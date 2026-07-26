import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { ConfigService } from '@nestjs/config';
import { Repository } from 'typeorm';
import { NotificationSettingsEntity } from '../../database/entities/notification-settings.entity';
import { encrypt, decrypt } from '../../common/crypto.util';
import { UpdateNotificationSettingsDto } from './dto/update-notification-settings.dto';

export type NotificationMode = 'live' | 'sandbox';

export type MaskedNotificationSettings = Omit<
  NotificationSettingsEntity,
  'lineChannelAccessTokenEnc'
> & { lineChannelAccessToken: string | null };

function maskToken(token: string): string {
  if (token.length <= 6) return '•'.repeat(token.length);
  return `${token.slice(0, 4)}${'•'.repeat(token.length - 6)}${token.slice(-2)}`;
}

@Injectable()
export class NotificationSettingsService {
  constructor(
    @InjectRepository(NotificationSettingsEntity)
    private repo: Repository<NotificationSettingsEntity>,
    private configService: ConfigService,
  ) {}

  private encryptionKey(): string {
    return this.configService.get<string>('security.tokenEncryptionKey')!;
  }

  async getSettings(mode: NotificationMode): Promise<NotificationSettingsEntity> {
    let row = await this.repo.findOne({ where: { mode } });
    if (!row) {
      await this.repo.upsert({ mode }, ['mode']);
      row = await this.repo.findOne({ where: { mode } });
    }
    return row!;
  }

  async seedIfEmpty(): Promise<void> {
    await Promise.all([this.getSettings('live'), this.getSettings('sandbox')]);
  }

  toMaskedDto(entity: NotificationSettingsEntity): MaskedNotificationSettings {
    const { lineChannelAccessTokenEnc, ...rest } = entity;
    let lineChannelAccessToken: string | null = null;
    if (lineChannelAccessTokenEnc) {
      try {
        lineChannelAccessToken = maskToken(decrypt(lineChannelAccessTokenEnc, this.encryptionKey()));
      } catch {
        lineChannelAccessToken = null;
      }
    }
    return { ...rest, lineChannelAccessToken };
  }

  async getMaskedSettings(mode: NotificationMode): Promise<MaskedNotificationSettings> {
    return this.toMaskedDto(await this.getSettings(mode));
  }

  // Internal-only: raw token, used exclusively by NotificationService right before
  // it calls the LINE API. Never held on an object field or logged.
  async getDecryptedToken(mode: NotificationMode): Promise<string | null> {
    const row = await this.getSettings(mode);
    if (!row.lineChannelAccessTokenEnc) return null;
    try {
      return decrypt(row.lineChannelAccessTokenEnc, this.encryptionKey());
    } catch {
      throw new Error(`[NotificationSettingsService] stored LINE token for mode '${mode}' is unreadable (TOKEN_ENCRYPTION_KEY likely rotated) — re-save the token in settings`);
    }
  }

  async updateSettings(
    mode: NotificationMode,
    dto: UpdateNotificationSettingsDto,
  ): Promise<MaskedNotificationSettings> {
    const existing = await this.repo.findOne({ where: { mode } });
    if (!existing) {
      throw new NotFoundException(`no notification settings for mode '${mode}'`);
    }
    const { lineChannelAccessToken, ...rest } = dto;
    const patch: Partial<NotificationSettingsEntity> = { ...rest };
    if (lineChannelAccessToken) {
      patch.lineChannelAccessTokenEnc = encrypt(lineChannelAccessToken, this.encryptionKey());
    }
    await this.repo.update({ mode }, patch);
    return this.getMaskedSettings(mode);
  }

  async markSent(mode: NotificationMode): Promise<MaskedNotificationSettings> {
    await this.repo.update({ mode }, { lastSentAt: new Date() });
    return this.getMaskedSettings(mode);
  }
}
