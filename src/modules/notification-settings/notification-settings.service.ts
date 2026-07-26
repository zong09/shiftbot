import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { ConfigService } from '@nestjs/config';
import { Repository } from 'typeorm';
import { NotificationSettingsEntity } from '../../database/entities/notification-settings.entity';
import { encrypt, decrypt } from '../../common/crypto.util';
import { UpdateNotificationSettingsDto } from './dto/update-notification-settings.dto';

export type NotificationMode = 'live' | 'sandbox';
export type NotificationChannel = 'line' | 'telegram';

export type MaskedNotificationSettings = Omit<
  NotificationSettingsEntity,
  'lineChannelAccessTokenEnc' | 'lineChannelSecretEnc' | 'telegramBotTokenEnc'
> & {
  lineChannelAccessToken: string | null;
  lineChannelSecret: string | null;
  telegramBotToken: string | null;
};

function maskToken(token: string): string {
  if (token.length <= 6) return '•'.repeat(token.length);
  return `${token.slice(0, 4)}${'•'.repeat(token.length - 6)}${token.slice(-2)}`;
}

/**
 * Every credential and id here is pasted from a provider console, and a clipboard copy
 * routinely drags a trailing newline along. The whitespace is invisible in the form but
 * travels into the `Authorization` header or the `to` field, where the provider rejects it
 * as a bare 401/400 with nothing in the message to debug. Trimming on the way in is the
 * only place that catches it — a stored value can no longer be told apart from a good one.
 */
function trimStrings<T extends object>(dto: T): T {
  return Object.fromEntries(
    Object.entries(dto).map(([key, value]) => [key, typeof value === 'string' ? value.trim() : value]),
  ) as T;
}

@Injectable()
export class NotificationSettingsService {
  private readonly logger = new Logger(NotificationSettingsService.name);

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

  // null for both "not set" and "stored under a rotated key" — an unreadable secret must
  // degrade to an empty field in the dashboard, never a 500.
  private maskStored(stored: string | null): string | null {
    if (!stored) return null;
    try {
      return maskToken(decrypt(stored, this.encryptionKey()));
    } catch {
      return null;
    }
  }

  toMaskedDto(entity: NotificationSettingsEntity): MaskedNotificationSettings {
    const {
      lineChannelAccessTokenEnc,
      lineChannelSecretEnc,
      telegramBotTokenEnc,
      ...rest
    } = entity;
    return {
      ...rest,
      lineChannelAccessToken: this.maskStored(lineChannelAccessTokenEnc),
      lineChannelSecret: this.maskStored(lineChannelSecretEnc),
      telegramBotToken: this.maskStored(telegramBotTokenEnc),
    };
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

  // Internal-only, same contract as getDecryptedToken: raw Telegram bot token handed to
  // NotificationService immediately before the API call, never stored on a field or logged.
  async getDecryptedTelegramToken(mode: NotificationMode): Promise<string | null> {
    const row = await this.getSettings(mode);
    if (!row.telegramBotTokenEnc) return null;
    try {
      return decrypt(row.telegramBotTokenEnc, this.encryptionKey());
    } catch {
      throw new Error(`[NotificationSettingsService] stored Telegram bot token for mode '${mode}' is unreadable (TOKEN_ENCRYPTION_KEY likely rotated) — re-save the token in settings`);
    }
  }

  // Used by the inbound LINE webhook to verify x-line-signature. Unlike
  // getDecryptedToken this never throws: an unreadable secret must make the webhook
  // answer 401, not 500 — a 500 just makes LINE retry the same doomed request.
  async getDecryptedChannelSecret(mode: NotificationMode): Promise<string | null> {
    const row = await this.getSettings(mode);
    if (!row.lineChannelSecretEnc) return null;
    try {
      return decrypt(row.lineChannelSecretEnc, this.encryptionKey());
    } catch {
      this.logger.error(
        `stored LINE channel secret for mode '${mode}' is unreadable (TOKEN_ENCRYPTION_KEY likely rotated) — re-save it in settings`,
      );
      return null;
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
    const { lineChannelAccessToken, lineChannelSecret, telegramBotToken, ...rest } = trimStrings(dto);
    const patch: Partial<NotificationSettingsEntity> = { ...rest };
    if (lineChannelAccessToken) {
      patch.lineChannelAccessTokenEnc = encrypt(lineChannelAccessToken, this.encryptionKey());
    }
    if (lineChannelSecret) {
      patch.lineChannelSecretEnc = encrypt(lineChannelSecret, this.encryptionKey());
    }
    if (telegramBotToken) {
      patch.telegramBotTokenEnc = encrypt(telegramBotToken, this.encryptionKey());
    }
    await this.repo.update({ mode }, patch);
    return this.getMaskedSettings(mode);
  }

  async markSent(mode: NotificationMode, channel: NotificationChannel): Promise<MaskedNotificationSettings> {
    const column = channel === 'telegram' ? 'telegramLastSentAt' : 'lastSentAt';
    await this.repo.update({ mode }, { [column]: new Date() });
    return this.getMaskedSettings(mode);
  }
}
