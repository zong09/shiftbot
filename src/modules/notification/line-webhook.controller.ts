import {
  Body,
  Controller,
  Headers,
  HttpCode,
  HttpStatus,
  Logger,
  Param,
  Post,
  RawBodyRequest,
  Req,
  UnauthorizedException,
} from '@nestjs/common';
import { createHmac, timingSafeEqual } from 'crypto';
import type { Request } from 'express';
import { ParseModePipe } from '../dashboard/mode.pipe';
import {
  NotificationMode,
  NotificationSettingsService,
} from '../notification-settings/notification-settings.service';
import { NotificationService } from './notification.service';

/**
 * HMAC-SHA256 ของ raw body ด้วย channel secret → base64 เทียบกับ header x-line-signature
 * (LINE ใช้ verify ว่า request มาจาก LINE จริง — endpoint นี้เป็น public ไม่มี JWT guard)
 */
export function verifyLineSignature(
  rawBody: Buffer | undefined,
  signature: string | undefined,
  secret: string | null,
): boolean {
  if (!rawBody || !signature || !secret) return false;
  const expected = createHmac('sha256', secret).update(rawBody).digest();
  const received = Buffer.from(signature, 'base64');
  // timingSafeEqual โยน error ถ้าความยาวไม่เท่ากัน
  if (expected.length !== received.length) return false;
  return timingSafeEqual(expected, received);
}

/**
 * รับ webhook จาก LINE เพื่อหา id ของปลายทาง (groupId / roomId / userId) เอาไปกรอกใน
 * หน้า Settings → GROUP ID ของ mode นั้น
 *
 * ตั้ง URL นี้ใน LINE Developers Console → Messaging API → Webhook URL
 * `:mode` ไม่ใช่ของประดับ — มันเลือก row ใน notification_settings ที่เอา channel secret
 * มา verify signature และ access token มาตอบกลับ ถ้า mode ใน URL ไม่ตรงกับ row ที่กรอก
 * secret ไว้จะ 401 ทุก request รวมถึงปุ่ม Verify
 */
@Controller('api/line')
export class LineWebhookController {
  private readonly logger = new Logger(LineWebhookController.name);

  constructor(
    private notificationService: NotificationService,
    private notificationSettingsService: NotificationSettingsService,
  ) {}

  // ต้องตอบ 200 เสมอเมื่อ signature ถูกต้อง — ปุ่ม Verify ใน console ส่ง events: [] มา
  @Post('webhook/:mode')
  @HttpCode(HttpStatus.OK)
  async handleWebhook(
    @Param('mode', ParseModePipe) mode: NotificationMode,
    @Req() req: RawBodyRequest<Request>,
    @Headers('x-line-signature') signature: string,
    @Body() body: any,
  ) {
    const channelSecret = await this.notificationSettingsService.getDecryptedChannelSecret(mode);
    if (!channelSecret) {
      this.logger.warn(`[${mode}] ยังไม่ได้ตั้ง LINE channel secret — ปฏิเสธ webhook`);
      throw new UnauthorizedException();
    }
    if (!verifyLineSignature(req.rawBody, signature, channelSecret)) {
      this.logger.warn(`[${mode}] LINE webhook signature ไม่ถูกต้อง — ทิ้ง request`);
      throw new UnauthorizedException();
    }

    for (const event of body?.events ?? []) {
      // error ของ event เดียวห้ามทำให้ทั้ง request เป็น 500 (LINE จะ retry ทั้งก้อน)
      try {
        const source = event.source ?? {};
        const id = source.groupId ?? source.roomId ?? source.userId;
        this.logger.log(
          `[${mode}] LINE webhook: event=${event.type} source=${source.type} id=${id}`,
        );

        // ตอบ id กลับเข้ากลุ่มตอนถูกเชิญเข้ามา (เฉพาะ join — ไม่งั้นรกทุกข้อความ)
        if (event.type === 'join' && event.replyToken) {
          await this.notificationService.replyLine(
            mode,
            event.replyToken,
            `id ของห้องนี้คือ ${id}\nเอาไปกรอกในหน้า Settings → การแจ้งเตือน LINE (${mode}) → GROUP ID แล้วกดบันทึก`,
          );
        }
      } catch (err) {
        this.logger.error(`[${mode}] จัดการ LINE event ไม่สำเร็จ: ${err.message}`);
      }
    }

    return { ok: true };
  }
}
