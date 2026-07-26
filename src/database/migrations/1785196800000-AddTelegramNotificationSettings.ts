import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Moves the Telegram notification config out of .env and into notification_settings,
 * per mode, with the bot token encrypted at rest exactly like the LINE token.
 *
 * Also splits the single `enabled` flag into `lineEnabled` + `telegramEnabled` so each
 * channel can be switched independently. The five unprefixed `notify*` event columns
 * stay LINE's; Telegram gets its own prefixed set, so existing rows keep their values.
 *
 * `IF NOT EXISTS` / `IF EXISTS` throughout keeps this safe on databases where dev
 * `synchronize` already applied the entity change. Column names are quoted camelCase to
 * match TypeORM's default naming strategy (no custom namingStrategy — see app.module.ts).
 *
 * DEV-ONLY DATA HAZARD: TypeORM runs `synchronize` *before* `migrationsRun`. When
 * synchronize is on (NODE_ENV !== 'production') it sees an entity with no `enabled`
 * column and drops it before the copy below can read it, so `lineEnabled` stays false.
 * Harmless on disposable dev data; on a real database make sure synchronize is off
 * (NODE_ENV=production) before deploying, or re-set the LINE toggle in Settings after.
 */
export class AddTelegramNotificationSettings1785196800000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    const columns: Array<[string, string]> = [
      ['lineEnabled', 'boolean NOT NULL DEFAULT false'],
      ['telegramEnabled', 'boolean NOT NULL DEFAULT false'],
      ['telegramBotTokenEnc', 'text'],
      ['telegramChatId', 'text'],
      ['telegramMessageThreadId', 'text'],
      ['telegramNotifyOpen', 'boolean NOT NULL DEFAULT true'],
      ['telegramNotifyClose', 'boolean NOT NULL DEFAULT true'],
      ['telegramNotifyTpSl', 'boolean NOT NULL DEFAULT true'],
      ['telegramNotifyError', 'boolean NOT NULL DEFAULT true'],
      ['telegramNotifyDailySummary', 'boolean NOT NULL DEFAULT false'],
      ['telegramLastSentAt', 'TIMESTAMP WITH TIME ZONE'],
    ];
    for (const [name, type] of columns) {
      await queryRunner.query(
        `ALTER TABLE "notification_settings" ADD COLUMN IF NOT EXISTS "${name}" ${type}`,
      );
    }

    // Carry the old single switch over to LINE's, then retire it.
    await queryRunner.query(`
      DO $$ BEGIN
        IF EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_name = 'notification_settings' AND column_name = 'enabled') THEN
          UPDATE "notification_settings" SET "lineEnabled" = "enabled";
        END IF;
      END $$
    `);
    await queryRunner.query(`ALTER TABLE "notification_settings" DROP COLUMN IF EXISTS "enabled"`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "notification_settings" ADD COLUMN IF NOT EXISTS "enabled" boolean NOT NULL DEFAULT false`,
    );
    await queryRunner.query(`
      DO $$ BEGIN
        IF EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_name = 'notification_settings' AND column_name = 'lineEnabled') THEN
          UPDATE "notification_settings" SET "enabled" = "lineEnabled";
        END IF;
      END $$
    `);
    const dropped = [
      'lineEnabled',
      'telegramEnabled',
      'telegramBotTokenEnc',
      'telegramChatId',
      'telegramMessageThreadId',
      'telegramNotifyOpen',
      'telegramNotifyClose',
      'telegramNotifyTpSl',
      'telegramNotifyError',
      'telegramNotifyDailySummary',
      'telegramLastSentAt',
    ];
    for (const name of dropped) {
      await queryRunner.query(
        `ALTER TABLE "notification_settings" DROP COLUMN IF EXISTS "${name}"`,
      );
    }
  }
}
