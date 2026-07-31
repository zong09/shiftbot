import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC_KEY = 'isPublic';

/**
 * ปลด JwtAuthGuard ออกจาก route เดียว
 *
 * JwtAuthGuard ถูกลงทะเบียนเป็น APP_GUARD (ดู auth.module.ts) — ทุก route ต้องมี JWT
 * โดยปริยาย route ที่เป็น public จริงๆ ต้องประกาศตัวเองด้วย decorator นี้ ไม่ใช่ปล่อยให้
 * เป็น public เพราะลืมใส่ guard เหมือนเดิม ตอนนี้มีแค่สองที่: POST /api/auth/login
 * (ยังไม่มี token) และ POST /api/line/webhook/:mode (auth ด้วย HMAC signature แทน)
 */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
