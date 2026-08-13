import { Type } from 'class-transformer';
import { IsIn, IsInt, IsNumber, IsString, Matches, Max, Min } from 'class-validator';
import { SYMBOL_PATTERN } from './update-settings.dto';

/**
 * Body of POST /api/positions/manual — เปิด position ด้วยมือโดยไม่รอสัญญาณ CDC.
 *
 * mode มาใน body (ไม่ใช่ path param) จึงตรวจด้วย @IsIn ไม่ใช่ ParseModePipe.
 * ไม่มี field ราคา: ราคาเข้าใช้ราคาสดจาก exchange ฝั่ง server เท่านั้น —
 * ไม่เชื่อราคาที่ client ส่งมา. Market order เท่านั้น (limit ยังไม่รองรับ).
 * ขนาด/leverage ที่ส่งมาใช้แทนค่าใน settings เฉพาะไม้นี้; SL/TP ยังยึด
 * stopLossPct/takeProfitPct ของ pair เสมอ.
 */
export class ManualOpenDto {
  @IsIn(['live', 'sandbox'])
  mode: 'live' | 'sandbox';

  @IsString()
  @Matches(SYMBOL_PATTERN, { message: 'symbol must look like BTC/USDT:USDT' })
  symbol: string;

  @IsIn(['long', 'short'])
  side: 'long' | 'short';

  @Type(() => Number)
  @IsNumber()
  @Min(5)
  @Max(100000)
  orderSizeUsdt: number;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  leverage: number;
}
