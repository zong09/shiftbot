import { Entity, PrimaryColumn, Column } from 'typeorm';

@Entity('notification_settings')
export class NotificationSettingsEntity {
  @PrimaryColumn()
  mode: string; // 'live' | 'sandbox'

  @Column({ default: false })
  lineEnabled: boolean;

  @Column({ type: 'text', nullable: true })
  lineWebhookUrl: string | null;

  @Column({ type: 'text', nullable: true })
  lineChannelAccessTokenEnc: string | null; // encrypted at rest — see src/common/crypto.util.ts

  @Column({ type: 'text', nullable: true })
  lineChannelSecretEnc: string | null; // encrypted at rest — verifies inbound webhook signatures

  @Column({ type: 'text', nullable: true })
  lineGroupId: string | null;

  @Column({ type: 'text', nullable: true })
  lineUserId: string | null;

  @Column({ default: true })
  notifyOpen: boolean;

  @Column({ default: true })
  notifyClose: boolean;

  @Column({ default: true })
  notifyTpSl: boolean;

  @Column({ default: true })
  notifyError: boolean;

  @Column({ default: false })
  notifyDailySummary: boolean;

  @Column({ type: 'timestamptz', nullable: true })
  lastSentAt: Date | null;

  // ── Telegram ──────────────────────────────────────────────
  // The five event flags above stay unprefixed (LINE's) so existing rows need no
  // data migration; Telegram's own set is prefixed. Each channel is enabled and
  // gated independently — see NotificationService.send().

  @Column({ default: false })
  telegramEnabled: boolean;

  @Column({ type: 'text', nullable: true })
  telegramBotTokenEnc: string | null; // encrypted at rest — see src/common/crypto.util.ts

  @Column({ type: 'text', nullable: true })
  telegramChatId: string | null;

  @Column({ type: 'text', nullable: true })
  telegramMessageThreadId: string | null; // optional — targets a topic inside a group

  @Column({ default: true })
  telegramNotifyOpen: boolean;

  @Column({ default: true })
  telegramNotifyClose: boolean;

  @Column({ default: true })
  telegramNotifyTpSl: boolean;

  @Column({ default: true })
  telegramNotifyError: boolean;

  @Column({ default: false })
  telegramNotifyDailySummary: boolean;

  @Column({ type: 'timestamptz', nullable: true })
  telegramLastSentAt: Date | null;
}
