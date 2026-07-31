import { Controller, Post, Body, HttpCode, HttpStatus } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';
import { Public } from './public.decorator';

@Controller('api/auth')
export class AuthController {
  constructor(private authService: AuthService) {}

  // The only way in — no JWT exists yet, so this route opts out of the global guard
  // and pays for it with a tighter limit than the global 120/min: brute-force
  // protection at 5 login attempts per minute per IP.
  @Public()
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('login')
  @HttpCode(HttpStatus.OK)
  async login(@Body() body: LoginDto) {
    return this.authService.login(body.username, body.password);
  }
}
