import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import { CDCResult, Position } from '../../common/types';

@Injectable()
export class NotificationService {
  private readonly logger = new Logger(NotificationService.name);
  private channel: string;
  private telegramToken: string;
  private telegramChatId: string;
  private lineAccessToken: string;
  private lineTo: string;

  constructor(private configService: ConfigService) {
    this.channel       = this.configService.get<string>('notification.channel', 'telegram');
    this.telegramToken = this.configService.get<string>('notification.telegram.botToken');
    this.telegramChatId= this.configService.get<string>('notification.telegram.chatId');
    this.lineAccessToken = this.configService.get<string>('notification.line.accessToken');
    this.lineTo          = this.configService.get<string>('notification.line.to');
  }

  async sendSignal(signal: 'BUY' | 'SELL', cdc: CDCResult, price: number): Promise<void> {
    const emoji = signal === 'BUY' ? '🟢' : '🔴';
    const msg =
      `${emoji} *CDC Action Zone Signal: ${signal}*\n` +
      `Zone: ${cdc.zoneName} (${cdc.zone})\n` +
      `Price: ${price.toFixed(2)} USDT\n` +
      `EMA12: ${cdc.emaFast.toFixed(2)} | EMA26: ${cdc.emaSlow.toFixed(2)}\n` +
      `Time: ${new Date().toLocaleString('th-TH')}`;

    await this.send(msg);
  }

  async sendOpenPosition(position: Position): Promise<void> {
    const sideText = position.side === 'long' ? 'Long' : 'Short';
    const msg =
      `📈 *เปิด ${sideText} Position*\n` +
      `Symbol: ${position.symbol}\n` +
      `Entry: ${position.entryPrice.toFixed(2)} USDT\n` +
      `Qty: ${position.quantity}\n` +
      `Stop Loss: ${position.stopLoss.toFixed(2)}\n` +
      `Take Profit: ${position.takeProfit.toFixed(2)}\n` +
      `Time: ${new Date().toLocaleString('th-TH')}`;

    await this.send(msg);
  }

  async sendClosePosition(
    position: Position,
    reason: 'SIGNAL' | 'SL' | 'TP' | 'MANUAL' | 'SYNC',
    currentPrice: number,
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

    await this.send(msg);
  }

  async sendError(message: string): Promise<void> {
    await this.send(`⚠️ *Bot Error*\n${message}`);
  }

  // ──────────────────────────────────────────────
  //  Internal send
  // ──────────────────────────────────────────────
  private async send(message: string): Promise<void> {
    const targets = this.channel === 'both'
      ? ['telegram', 'line']
      : [this.channel];

    for (const target of targets) {
      try {
        if (target === 'telegram') await this.sendTelegram(message);
        if (target === 'line')     await this.sendLine(message);
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

  private async sendLine(message: string): Promise<void> {
    if (!this.lineAccessToken || !this.lineTo) {
      this.logger.warn('LINE Messaging API config ไม่ครบ');
      return;
    }
    // ลบ Markdown formatting สำหรับ LINE
    const plainText = message.replace(/\*/g, '');
    await axios.post(
      'https://api.line.me/v2/bot/message/push',
      { to: this.lineTo, messages: [{ type: 'text', text: plainText }] },
      { headers: { Authorization: `Bearer ${this.lineAccessToken}`, 'Content-Type': 'application/json' } },
    );
    this.logger.log('ส่ง LINE Messaging API สำเร็จ');
  }
}