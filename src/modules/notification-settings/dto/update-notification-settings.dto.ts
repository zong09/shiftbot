import { IsBoolean, IsOptional, IsString, IsUrl } from 'class-validator';

export class UpdateNotificationSettingsDto {
  @IsOptional()
  @IsBoolean()
  lineEnabled?: boolean;

  @IsOptional()
  @IsUrl({ require_tld: false })
  lineWebhookUrl?: string;

  // Only present when the user actually typed a new token — the frontend never
  // round-trips the masked placeholder back as a real value.
  @IsOptional()
  @IsString()
  lineChannelAccessToken?: string;

  @IsOptional()
  @IsString()
  lineChannelSecret?: string;

  @IsOptional()
  @IsString()
  lineGroupId?: string;

  @IsOptional()
  @IsString()
  lineUserId?: string;

  @IsOptional()
  @IsBoolean()
  notifyOpen?: boolean;

  @IsOptional()
  @IsBoolean()
  notifyClose?: boolean;

  @IsOptional()
  @IsBoolean()
  notifyTpSl?: boolean;

  @IsOptional()
  @IsBoolean()
  notifyError?: boolean;

  @IsOptional()
  @IsBoolean()
  notifyDailySummary?: boolean;

  @IsOptional()
  @IsBoolean()
  telegramEnabled?: boolean;

  // Same contract as lineChannelAccessToken — only present when newly typed.
  @IsOptional()
  @IsString()
  telegramBotToken?: string;

  @IsOptional()
  @IsString()
  telegramChatId?: string;

  @IsOptional()
  @IsString()
  telegramMessageThreadId?: string;

  @IsOptional()
  @IsBoolean()
  telegramNotifyOpen?: boolean;

  @IsOptional()
  @IsBoolean()
  telegramNotifyClose?: boolean;

  @IsOptional()
  @IsBoolean()
  telegramNotifyTpSl?: boolean;

  @IsOptional()
  @IsBoolean()
  telegramNotifyError?: boolean;

  @IsOptional()
  @IsBoolean()
  telegramNotifyDailySummary?: boolean;
}
