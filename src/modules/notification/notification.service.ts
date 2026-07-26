import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import { CDCResult, Position } from '../../common/types';
import {
  NotificationSettingsService,
  NotificationMode,
} from '../notification-settings/notification-settings.service';

@Injectable()
export class NotificationService {
  private readonly logger = new Logger(NotificationService.name);
  private channel: string;
  private telegramToken: string;
  private telegramChatId: string;

  constructor(
    private configService: ConfigService,
    private notificationSettingsService: NotificationSettingsService,
  ) {
    this.channel        = this.configService.get<string>('notification.channel', 'telegram');
    this.telegramToken  = this.configService.get<string>('notification.telegram.botToken');
    this.telegramChatId = this.configService.get<string>('notification.telegram.chatId');
  }

  async sendSignal(signal: 'BUY' | 'SELL', cdc: CDCResult, price: number, mode: NotificationMode): Promise<void> {
    const emoji = signal === 'BUY' ? '🟢' : '🔴';
    const msg =
      `${emoji} *CDC Action Zone Signal: ${signal}*\n` +
      `Zone: ${cdc.zoneName} (${cdc.zone})\n` +
      `Price: ${price.toFixed(2)} USDT\n` +
      `EMA12: ${cdc.emaFast.toFixed(2)} | EMA26: ${cdc.emaSlow.toFixed(2)}\n` +
      `Time: ${new Date().toLocaleString('th-TH')}`;

    await this.send(msg, mode, 'notifyOpen');
  }

  async sendOpenPosition(position: Position, mode: NotificationMode): Promise<void> {
    const sideText = position.side === 'long' ? 'Long' : 'Short';
    const msg =
      `📈 *เปิด ${sideText} Position*\n` +
      `Symbol: ${position.symbol}\n` +
      `Entry: ${position.entryPrice.toFixed(2)} USDT\n` +
      `Qty: ${position.quantity}\n` +
      `Stop Loss: ${position.stopLoss.toFixed(2)}\n` +
      `Take Profit: ${position.takeProfit.toFixed(2)}\n` +
      `Time: ${new Date().toLocaleString('th-TH')}`;

    await this.send(msg, mode, 'notifyOpen');
  }

  async sendClosePosition(
    position: Position,
    reason: 'SIGNAL' | 'SL' | 'TP' | 'MANUAL' | 'SYNC',
    currentPrice: number,
    mode: NotificationMode,
  ): Promise<void> {
    const pnl = position.closedPnl ?? 0;
    const emoji = pnl >= 0 ? '✅' : '❌';
    const reasonText = { SIGNAL: 'Signal', SL: 'Stop Loss', TP: 'Take Profit', MANUAL: 'Manual', SYNC: 'ปิดบน Exchange (SL/TP)' }[reason];

    const sideText = position.side === 'long' ? 'Long' : 'Short';
    const msg =
      `${emoji} *ปิด ${sideText} Position (${reasonText})*\n` +
      `Symbol: ${position.symbol}\n` +
      `Exit Price: ${currentPrice.toFixed(2)} USDT\n` +
      `Entry Price: ${position.entryPrice.toFixed(2)} USDT\n` +
      `PnL: ${pnl >= 0 ? '+' : ''}${pnl.toFixed(2)} USDT\n` +
      `Time: ${new Date().toLocaleString('th-TH')}`;

    const flag = reason === 'SL' || reason === 'TP' ? 'notifyTpSl' : 'notifyClose';
    await this.send(msg, mode, flag);
  }

  async sendError(message: string, mode: NotificationMode): Promise<void> {
    // Exchange errors routinely contain *, _, [ — with parse_mode:'Markdown' Telegram
    // rejects an unbalanced message with 400 and the alert is silently lost. Strip the
    // Markdown-significant characters from the (untrusted) error text before sending.
    const safe = message.replace(/[*_[\]`]/g, '');
    await this.send(`⚠️ *Bot Error*\n${safe}`, mode, 'notifyError');
  }

  /** Explicit user-triggered test send — bypasses per-event flags, still requires `enabled` + LINE config. */
  async sendTest(mode: NotificationMode): Promise<void> {
    const msg = `🔔 *ทดสอบการแจ้งเตือน*\nโหมด: ${mode}\nTime: ${new Date().toLocaleString('th-TH')}`;
    await this.send(msg, mode, null);
  }

  /**
   * ตอบกลับเข้า chat ที่ยิง webhook มา (ใช้บอก groupId ตอนบอทถูกเชิญเข้ากลุ่ม).
   *
   * ต่างจาก sendLine โดยตั้งใจ 2 อย่าง: ไม่เช็ค settings.enabled (การหา groupId
   * เกิดก่อนผู้ใช้เปิดสวิตช์แจ้งเตือน — ถ้าเช็คจะหา id ไม่ได้เลย) และกลืน error
   * ทั้งหมด เพราะ webhook ต้องตอบ 200 ให้ LINE ไม่งั้นโดน retry ซ้ำ
   * (getDecryptedToken throw ได้เมื่อ TOKEN_ENCRYPTION_KEY ถูก rotate)
   */
  async replyLine(mode: NotificationMode, replyToken: string, text: string): Promise<void> {
    try {
      const lineToken = await this.notificationSettingsService.getDecryptedToken(mode);
      if (!lineToken) {
        this.logger.warn(`[${mode}] ยังไม่ได้ตั้ง LINE channel access token — ตอบกลับไม่ได้`);
        return;
      }
      await axios.post(
        'https://api.line.me/v2/bot/message/reply',
        { replyToken, messages: [{ type: 'text', text }] },
        { headers: { Authorization: `Bearer ${lineToken}`, 'Content-Type': 'application/json' } },
      );
      this.logger.log(`[${mode}] ตอบกลับ LINE สำเร็จ`);
    } catch (err) {
      this.logger.error(`[${mode}] LINE reply failed: ${err.message}`);
    }
  }

  // ──────────────────────────────────────────────
  //  Internal send
  // ──────────────────────────────────────────────
  private async send(
    message: string,
    mode: NotificationMode,
    eventFlag: 'notifyOpen' | 'notifyClose' | 'notifyTpSl' | 'notifyError' | null,
  ): Promise<void> {
    const targets = this.channel === 'both'
      ? ['telegram', 'line']
      : [this.channel];

    for (const target of targets) {
      try {
        if (target === 'telegram') await this.sendTelegram(message);
        if (target === 'line')     await this.sendLine(message, mode, eventFlag);
      } catch (err) {
        this.logger.error(`Send to ${target} failed: ${err.message}`);
      }
    }
  }

  private async sendTelegram(message: string): Promise<void> {
    if (!this.telegramToken || !this.telegramChatId) {
      this.logger.warn('Telegram config ไม่ครบ');
      return;
    }
    await axios.post(`https://api.telegram.org/bot${this.telegramToken}/sendMessage`, {
      chat_id:    this.telegramChatId,
      text:       message,
      parse_mode: 'Markdown',
    });
    this.logger.log('ส่ง Telegram สำเร็จ');
  }

  private async sendLine(
    message: string,
    mode: NotificationMode,
    eventFlag: 'notifyOpen' | 'notifyClose' | 'notifyTpSl' | 'notifyError' | null,
  ): Promise<void> {
    const settings = await this.notificationSettingsService.getSettings(mode);
    if (!settings.enabled) {
      this.logger.debug(`[${mode}] LINE notifications disabled — skip`);
      return;
    }
    if (eventFlag && !settings[eventFlag]) {
      this.logger.debug(`[${mode}] LINE event '${eventFlag}' disabled — skip`);
      return;
    }
    const lineTo = settings.lineGroupId || settings.lineUserId;
    const lineToken = await this.notificationSettingsService.getDecryptedToken(mode);
    if (!lineToken || !lineTo) {
      this.logger.debug(`[${mode}] LINE config ไม่ครบ — skip`);
      return;
    }
    // ลบ Markdown formatting สำหรับ LINE
    const plainText = message.replace(/\*/g, '');
    await axios.post(
      'https://api.line.me/v2/bot/message/push',
      { to: lineTo, messages: [{ type: 'text', text: plainText }] },
      { headers: { Authorization: `Bearer ${lineToken}`, 'Content-Type': 'application/json' } },
    );
    this.logger.log(`[${mode}] ส่ง LINE Messaging API สำเร็จ`);
  }
}
