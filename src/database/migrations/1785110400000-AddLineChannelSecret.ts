import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Adds notification_settings.lineChannelSecretEnc — the LINE channel secret used to
 * verify the x-line-signature header on inbound webhooks (POST /api/line/webhook/:mode).
 *
 * `IF NOT EXISTS` keeps this safe on databases where dev `synchronize` already added
 * the column. Column name is quoted camelCase to match TypeORM's default naming
 * strategy (no custom namingStrategy is configured — see app.module.ts).
 */
export class AddLineChannelSecret1785110400000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "notification_settings" ADD COLUMN IF NOT EXISTS "lineChannelSecretEnc" text`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "notification_settings" DROP COLUMN IF EXISTS "lineChannelSecretEnc"`,
    );
  }
}
