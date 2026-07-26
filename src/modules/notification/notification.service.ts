import { Injectable, Logger } from '@nestjs/common';
import axios from 'axios';
import { CDCResult, Position } from '../../common/types';
import { NotificationSettingsEntity } from '../../database/entities/notification-settings.entity';
import {
  NotificationSettingsService,
  NotificationMode,
  NotificationChannel,
} from '../notification-settings/notification-settings.service';

/** Logical event a message belongs to; `null` bypasses per-event filtering (test sends). */
type NotifyEvent = 'open' | 'close' | 'tpsl' | 'error';

// Each channel keeps its own five flags, so the logical event resolves to a different
// column per channel. Explicit map rather than string building — it greps.
const EVENT_COLUMN: Record<NotificationChannel, Record<NotifyEvent, keyof NotificationSettingsEntity>> = {
  line: {
    open:  'notifyOpen',
    close: 'notifyClose',
    tpsl:  'notifyTpSl',
    error: 'notifyError',
  },
  telegram: {
    open:  'telegramNotifyOpen',
    close: 'telegramNotifyClose',
    tpsl:  'telegramNotifyTpSl',
    error: 'telegramNotifyError',
  },
};

@Injectable()
export class NotificationService {
  private readonly logger = new Logger(NotificationService.name);

  constructor(private notificationSettingsService: NotificationSettingsService) {}

  async sendSignal(signal: 'BUY' | 'SELL', cdc: CDCResult, price: number, mode: NotificationMode): Promise<void> {
    const emoji = signal === 'BUY' ? '🟢' : '🔴';
    const msg =
      `${emoji} *CDC Action Zone Signal: ${signal}*\n` +
      `Zone: ${cdc.zoneName} (${cdc.zone})\n` +
      `Price: ${price.toFixed(2)} USDT\n` +
      `EMA12: ${cdc.emaFast.toFixed(2)} | EMA26: ${cdc.emaSlow.toFixed(2)}\n` +
      `Time: ${new Date().toLocaleString('th-TH')}`;

    await this.send(msg, mode, 'open');
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

    await this.send(msg, mode, 'open');
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

    const event: NotifyEvent = reason === 'SL' || reason === 'TP' ? 'tpsl' : 'close';
    await this.send(msg, mode, event);
  }

  async sendError(message: string, mode: NotificationMode): Promise<void> {
    // Exchange errors routinely contain *, _, [ — with parse_mode:'Markdown' Telegram
    // rejects an unbalanced message with 400 and the alert is silently lost. Strip the
    // Markdown-significant characters from the (untrusted) error text before sending.
    const safe = message.replace(/[*_[\]`]/g, '');
    await this.send(`⚠️ *Bot Error*\n${safe}`, mode, 'error');
  }

  /**
   * Explicit user-triggered test send to one channel. Bypasses both the per-event flags
   * and the channel's own enable switch — the point of the button is to verify credentials
   * before you flip the switch on. Returns whether a message actually went out, so the
   * caller only stamps "last sent" when it did (otherwise the dashboard would lie).
   */
  async sendTest(mode: NotificationMode, channel: NotificationChannel): Promise<boolean> {
    const msg = `🔔 *ทดสอบการแจ้งเตือน*\nโหมด: ${mode}\nTime: ${new Date().toLocaleString('th-TH')}`;
    const settings = await this.notificationSettingsService.getSettings(mode);
    return channel === 'telegram'
      ? this.sendTelegram(msg, mode, settings, null, true)
      : this.sendLine(msg, mode, settings, null, true);
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
  /**
   * Fans out to every channel. Each channel is gated only by its own DB config —
   * `lineEnabled` / `telegramEnabled` plus its own copy of the event flag — so one
   * channel being off or misconfigured never suppresses the other. A failing channel is
   * logged and the loop continues.
   */
  private async send(message: string, mode: NotificationMode, event: NotifyEvent | null): Promise<void> {
    const settings = await this.notificationSettingsService.getSettings(mode);

    const targets: Array<[NotificationChannel, () => Promise<boolean>]> = [
      ['line',     () => this.sendLine(message, mode, settings, event)],
      ['telegram', () => this.sendTelegram(message, mode, settings, event)],
    ];

    for (const [channel, sendFn] of targets) {
      try {
        await sendFn();
      } catch (err) {
        this.logger.error(`[${mode}] Send to ${channel} failed: ${err.message}`);
      }
    }
  }

  /** Returns true only when a message was actually handed to the provider. */
  private async sendTelegram(
    message: string,
    mode: NotificationMode,
    settings: NotificationSettingsEntity,
    event: NotifyEvent | null,
    ignoreEnabled = false,
  ): Promise<boolean> {
    if (!ignoreEnabled && !settings.telegramEnabled) {
      this.logger.debug(`[${mode}] Telegram notifications disabled — skip`);
      return false;
    }
    if (event && !settings[EVENT_COLUMN.telegram[event]]) {
      this.logger.debug(`[${mode}] Telegram event '${event}' disabled — skip`);
      return false;
    }
    const token = await this.notificationSettingsService.getDecryptedTelegramToken(mode);
    if (!token || !settings.telegramChatId) {
      this.logger.debug(`[${mode}] Telegram config ไม่ครบ — skip`);
      return false;
    }
    await axios.post(`https://api.telegram.org/bot${token}/sendMessage`, {
      chat_id:    settings.telegramChatId,
      text:       message,
      parse_mode: 'Markdown',
      // Only present for forum-style groups; Telegram rejects a null thread id.
      ...(settings.telegramMessageThreadId
        ? { message_thread_id: settings.telegramMessageThreadId }
        : {}),
    });
    this.logger.log(`[${mode}] ส่ง Telegram สำเร็จ`);
    return true;
  }

  /** Returns true only when a message was actually handed to the provider. */
  private async sendLine(
    message: string,
    mode: NotificationMode,
    settings: NotificationSettingsEntity,
    event: NotifyEvent | null,
    ignoreEnabled = false,
  ): Promise<boolean> {
    if (!ignoreEnabled && !settings.lineEnabled) {
      this.logger.debug(`[${mode}] LINE notifications disabled — skip`);
      return false;
    }
    if (event && !settings[EVENT_COLUMN.line[event]]) {
      this.logger.debug(`[${mode}] LINE event '${event}' disabled — skip`);
      return false;
    }
    const lineTo = settings.lineGroupId || settings.lineUserId;
    const lineToken = await this.notificationSettingsService.getDecryptedToken(mode);
    if (!lineToken || !lineTo) {
      this.logger.debug(`[${mode}] LINE config ไม่ครบ — skip`);
      return false;
    }
    // ลบ Markdown formatting สำหรับ LINE
    const plainText = message.replace(/\*/g, '');
    await axios.post(
      'https://api.line.me/v2/bot/message/push',
      { to: lineTo, messages: [{ type: 'text', text: plainText }] },
      { headers: { Authorization: `Bearer ${lineToken}`, 'Content-Type': 'application/json' } },
    );
    this.logger.log(`[${mode}] ส่ง LINE Messaging API สำเร็จ`);
    return true;
  }
}
