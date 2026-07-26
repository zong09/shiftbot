import { Entity, PrimaryColumn, Column } from 'typeorm';

@Entity('notification_settings')
export class NotificationSettingsEntity {
  @PrimaryColumn()
  mode: string; // 'live' | 'sandbox'

  @Column({ default: false })
  enabled: boolean;

  @Column({ type: 'text', nullable: true })
  lineWebhookUrl: string | null;

  @Column({ type: 'text', nullable: true })
  lineChannelAccessTokenEnc: string | null; // encrypted at rest — see src/common/crypto.util.ts

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
}
