import {
  ConflictException,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { AuthTokens, CognitoService } from '../cognito/cognito.service';
import { looksLikeEmail, toE164 } from '../common/utils/phone';
import { PrismaService } from '../prisma/prisma.service';
import { toProfile, UserProfile } from '../users/user-profile';
import {
  ConfirmSignUpDto,
  LoginDto,
  RegisterDto,
  ResetPasswordDto,
} from './dto/auth.dto';

const invalidCredentials = () =>
  new UnauthorizedException({
    code: 'INVALID_CREDENTIALS',
    message: 'Invalid credentials',
  });

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly cognito: CognitoService,
  ) {}

  async register(dto: RegisterDto): Promise<{ user: UserProfile }> {
    const existing = await this.prisma.user.findFirst({
      where: { OR: [{ email: dto.email }, { mobile: dto.mobile }] },
    });
    if (existing) {
      throw existing.email === dto.email
        ? new ConflictException({
            code: 'EMAIL_EXISTS',
            message: 'An account with this email already exists',
          })
        : new ConflictException({
            code: 'MOBILE_EXISTS',
            message: 'An account with this mobile number already exists',
          });
    }

    const { sub } = await this.cognito.signUp(
      dto.email,
      dto.password,
      dto.fullName,
      dto.mobile,
    );

    try {
      const user = await this.prisma.user.create({
        data: {
          cognitoSub: sub,
          fullName: dto.fullName,
          email: dto.email,
          mobile: dto.mobile,
        },
      });
      return { user: toProfile(user) };
    } catch (err) {
      // Keep Cognito and the DB consistent if the insert fails (e.g. a race on mobile).
      this.logger.warn(`Rolling back Cognito user ${sub}: ${String(err)}`);
      await this.cognito.deleteUser(sub).catch(() => undefined);
      throw err;
    }
  }

  confirmSignUp(dto: ConfirmSignUpDto): Promise<void> {
    return this.cognito.confirmSignUp(dto.email, dto.code);
  }

  resendConfirmationCode(email: string): Promise<void> {
    return this.cognito.resendConfirmationCode(email);
  }

  async login(dto: LoginDto): Promise<AuthTokens & { user: UserProfile }> {
    const user = await this.findByIdentifier(dto.identifier);
    if (!user) {
      throw invalidCredentials();
    }
    const tokens = await this.cognito.login(user.email, dto.password);
    return { ...tokens, user: toProfile(user) };
  }

  refresh(refreshToken: string): Promise<AuthTokens> {
    return this.cognito.refresh(refreshToken);
  }

  logout(accessToken: string): Promise<void> {
    return this.cognito.globalSignOut(accessToken);
  }

  async forgotPassword(email: string): Promise<void> {
    // Always succeed so callers can't probe which emails are registered.
    await this.cognito.forgotPassword(email).catch((err: unknown) => {
      this.logger.warn(`forgotPassword failed: ${String(err)}`);
    });
  }

  resetPassword(dto: ResetPasswordDto): Promise<void> {
    return this.cognito.confirmForgotPassword(
      dto.email,
      dto.code,
      dto.newPassword,
    );
  }

  private findByIdentifier(identifier: string) {
    if (looksLikeEmail(identifier)) {
      return this.prisma.user.findUnique({
        where: { email: identifier.toLowerCase() },
      });
    }
    const mobile = toE164(identifier);
    return mobile
      ? this.prisma.user.findUnique({ where: { mobile } })
      : Promise.resolve(null);
  }
}
