import { Body, Controller, HttpCode, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { AuthService } from './auth.service';
import type { AuthUser } from './cognito-jwt.guard';
import { CognitoJwtGuard, CurrentUser } from './cognito-jwt.guard';
import {
  ConfirmSignUpDto,
  EmailDto,
  LoginDto,
  RefreshDto,
  RegisterDto,
  ResetPasswordDto,
} from './dto/auth.dto';

const STRICT = { default: { limit: 5, ttl: 60_000 } };
const ok = { success: true };

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  /** Creates the account and emails a 6-digit verification code. */
  @Throttle(STRICT)
  @Post('register')
  register(@Body() dto: RegisterDto) {
    return this.auth.register(dto);
  }

  /** Confirms the email with the code sent at registration. */
  @Throttle(STRICT)
  @Post('confirm-signup')
  @HttpCode(200)
  async confirmSignUp(@Body() dto: ConfirmSignUpDto) {
    await this.auth.confirmSignUp(dto);
    return ok;
  }

  @Throttle(STRICT)
  @Post('resend-code')
  @HttpCode(200)
  async resendCode(@Body() dto: EmailDto) {
    await this.auth.resendConfirmationCode(dto.email);
    return ok;
  }

  /** Log in with email or mobile number. 403 USER_NOT_CONFIRMED means the email isn't verified yet. */
  @Throttle(STRICT)
  @Post('login')
  @HttpCode(200)
  login(@Body() dto: LoginDto) {
    return this.auth.login(dto);
  }

  @Post('refresh')
  @HttpCode(200)
  refresh(@Body() dto: RefreshDto) {
    return this.auth.refresh(dto.refreshToken);
  }

  /** Signs the user out on all devices (revokes refresh tokens). */
  @ApiBearerAuth()
  @UseGuards(CognitoJwtGuard)
  @Post('logout')
  @HttpCode(200)
  async logout(@CurrentUser() user: AuthUser) {
    await this.auth.logout(user.accessToken);
    return ok;
  }

  /** Emails a 6-digit reset code. Always returns 200. */
  @Throttle(STRICT)
  @Post('forgot-password')
  @HttpCode(200)
  async forgotPassword(@Body() dto: EmailDto) {
    await this.auth.forgotPassword(dto.email);
    return ok;
  }

  @Throttle(STRICT)
  @Post('reset-password')
  @HttpCode(200)
  async resetPassword(@Body() dto: ResetPasswordDto) {
    await this.auth.resetPassword(dto);
    return ok;
  }
}
