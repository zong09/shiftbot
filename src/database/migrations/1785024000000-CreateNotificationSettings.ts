import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Creates the notification_settings table.
 *
 * This table was introduced with the per-mode LINE notification feature but had
 * no migration, so it only ever existed on databases where `synchronize` was
 * enabled. `IF NOT EXISTS` keeps this safe to run against a database where
 * synchronize already created the table.
 *
 * Column names are quoted camelCase to match TypeORM's default naming strategy
 * (no custom namingStrategy is configured — see app.module.ts). The primary key
 * constraint reuses TypeORM's own generated name so a migration-created table is
 * byte-identical to a synchronize-created one and reads as no drift.
 */
export class CreateNotificationSettings1785024000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "notification_settings" (
        "mode" character varying NOT NULL,
        "enabled" boolean NOT NULL DEFAULT false,
        "lineWebhookUrl" text,
        "lineChannelAccessTokenEnc" text,
        "lineGroupId" text,
        "lineUserId" text,
        "notifyOpen" boolean NOT NULL DEFAULT true,
        "notifyClose" boolean NOT NULL DEFAULT true,
        "notifyTpSl" boolean NOT NULL DEFAULT true,
        "notifyError" boolean NOT NULL DEFAULT true,
        "notifyDailySummary" boolean NOT NULL DEFAULT false,
        "lastSentAt" TIMESTAMP WITH TIME ZONE,
        CONSTRAINT "PK_10e02246fec907b852285f5d51e" PRIMARY KEY ("mode")
      )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "notification_settings"`);
  }
}
