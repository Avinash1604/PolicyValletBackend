import {
  AdminDeleteUserCommand,
  AdminUpdateUserAttributesCommand,
  AttributeType,
  ChangePasswordCommand,
  CognitoIdentityProviderClient,
  ConfirmForgotPasswordCommand,
  ConfirmSignUpCommand,
  ForgotPasswordCommand,
  GlobalSignOutCommand,
  InitiateAuthCommand,
  ResendConfirmationCodeCommand,
  SignUpCommand,
  VerifyUserAttributeCommand,
} from '@aws-sdk/client-cognito-identity-provider';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Injectable,
  InternalServerErrorException,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CognitoJwtVerifier } from 'aws-jwt-verify';

export interface AuthTokens {
  accessToken: string;
  idToken: string;
  refreshToken?: string;
  expiresIn: number;
  tokenType: string;
}

/** Thin wrapper around Cognito so the rest of the app never touches the AWS SDK directly. */
@Injectable()
export class CognitoService {
  private readonly logger = new Logger(CognitoService.name);
  private readonly client: CognitoIdentityProviderClient;
  private readonly userPoolId: string;
  private readonly clientId: string;
  private readonly verifier: ReturnType<typeof CognitoJwtVerifier.create>;

  constructor(config: ConfigService) {
    this.userPoolId = config.getOrThrow<string>('cognito.userPoolId');
    this.clientId = config.getOrThrow<string>('cognito.clientId');
    this.client = new CognitoIdentityProviderClient({
      region: config.getOrThrow<string>('aws.region'),
    });
    this.verifier = CognitoJwtVerifier.create({
      userPoolId: this.userPoolId,
      clientId: this.clientId,
      tokenUse: 'access',
    });
  }

  /** Returns the Cognito `sub` of a valid access token, or throws 401. */
  async verifyAccessToken(token: string): Promise<string> {
    try {
      const payload = await this.verifier.verify(token);
      return payload.sub;
    } catch {
      throw new UnauthorizedException('Invalid or expired token');
    }
  }

  async signUp(
    email: string,
    password: string,
    fullName: string,
    mobile: string,
  ): Promise<{ sub: string }> {
    const res = await this.run(() =>
      this.client.send(
        new SignUpCommand({
          ClientId: this.clientId,
          Username: email,
          Password: password,
          UserAttributes: [
            { Name: 'email', Value: email },
            { Name: 'name', Value: fullName },
            { Name: 'phone_number', Value: mobile },
          ],
        }),
      ),
    );
    return { sub: res.UserSub as string };
  }

  async confirmSignUp(email: string, code: string): Promise<void> {
    await this.run(() =>
      this.client.send(
        new ConfirmSignUpCommand({
          ClientId: this.clientId,
          Username: email,
          ConfirmationCode: code,
        }),
      ),
    );
  }

  async resendConfirmationCode(email: string): Promise<void> {
    await this.run(() =>
      this.client.send(
        new ResendConfirmationCodeCommand({
          ClientId: this.clientId,
          Username: email,
        }),
      ),
    );
  }

  async login(email: string, password: string): Promise<AuthTokens> {
    const res = await this.run(() =>
      this.client.send(
        new InitiateAuthCommand({
          ClientId: this.clientId,
          AuthFlow: 'USER_PASSWORD_AUTH',
          AuthParameters: { USERNAME: email, PASSWORD: password },
        }),
      ),
    );
    return this.toTokens(res.AuthenticationResult);
  }

  async refresh(refreshToken: string): Promise<AuthTokens> {
    const res = await this.run(() =>
      this.client.send(
        new InitiateAuthCommand({
          ClientId: this.clientId,
          AuthFlow: 'REFRESH_TOKEN_AUTH',
          AuthParameters: { REFRESH_TOKEN: refreshToken },
        }),
      ),
    );
    return this.toTokens(res.AuthenticationResult);
  }

  async globalSignOut(accessToken: string): Promise<void> {
    await this.run(() =>
      this.client.send(new GlobalSignOutCommand({ AccessToken: accessToken })),
    );
  }

  async forgotPassword(email: string): Promise<void> {
    await this.run(() =>
      this.client.send(
        new ForgotPasswordCommand({ ClientId: this.clientId, Username: email }),
      ),
    );
  }

  async confirmForgotPassword(
    email: string,
    code: string,
    newPassword: string,
  ): Promise<void> {
    await this.run(() =>
      this.client.send(
        new ConfirmForgotPasswordCommand({
          ClientId: this.clientId,
          Username: email,
          ConfirmationCode: code,
          Password: newPassword,
        }),
      ),
    );
  }

  async changePassword(
    accessToken: string,
    currentPassword: string,
    newPassword: string,
  ): Promise<void> {
    await this.run(() =>
      this.client.send(
        new ChangePasswordCommand({
          AccessToken: accessToken,
          PreviousPassword: currentPassword,
          ProposedPassword: newPassword,
        }),
      ),
    );
  }

  /** Updating `email` makes Cognito send a verification code; the old email stays active until verified. */
  async updateAttributes(
    sub: string,
    attributes: Record<string, string>,
  ): Promise<void> {
    const UserAttributes: AttributeType[] = Object.entries(attributes).map(
      ([Name, Value]) => ({ Name, Value }),
    );
    await this.run(() =>
      this.client.send(
        new AdminUpdateUserAttributesCommand({
          UserPoolId: this.userPoolId,
          Username: sub,
          UserAttributes,
        }),
      ),
    );
  }

  async verifyEmail(accessToken: string, code: string): Promise<void> {
    await this.run(() =>
      this.client.send(
        new VerifyUserAttributeCommand({
          AccessToken: accessToken,
          AttributeName: 'email',
          Code: code,
        }),
      ),
    );
  }

  async deleteUser(sub: string): Promise<void> {
    await this.run(() =>
      this.client.send(
        new AdminDeleteUserCommand({
          UserPoolId: this.userPoolId,
          Username: sub,
        }),
      ),
    );
  }

  private toTokens(
    result:
      | {
          AccessToken?: string;
          IdToken?: string;
          RefreshToken?: string;
          ExpiresIn?: number;
          TokenType?: string;
        }
      | undefined,
  ): AuthTokens {
    if (!result?.AccessToken || !result.IdToken) {
      // Happens if the pool requires a challenge (e.g. MFA) we don't support yet.
      throw new UnauthorizedException('Additional authentication required');
    }
    return {
      accessToken: result.AccessToken,
      idToken: result.IdToken,
      refreshToken: result.RefreshToken,
      expiresIn: result.ExpiresIn ?? 3600,
      tokenType: result.TokenType ?? 'Bearer',
    };
  }

  private async run<T>(call: () => Promise<T>): Promise<T> {
    try {
      return await call();
    } catch (err) {
      throw this.mapError(err);
    }
  }

  private mapError(err: unknown): HttpException {
    const name = (err as { name?: string }).name ?? 'Unknown';
    const message = (err as { message?: string }).message ?? '';
    switch (name) {
      case 'UsernameExistsException':
      case 'AliasExistsException':
        return new ConflictException({
          code: 'EMAIL_EXISTS',
          message: 'An account with this email already exists',
        });
      case 'NotAuthorizedException':
      case 'UserNotFoundException':
        return new UnauthorizedException({
          code: 'INVALID_CREDENTIALS',
          message: 'Invalid credentials',
        });
      case 'UserNotConfirmedException':
        return new ForbiddenException({
          code: 'USER_NOT_CONFIRMED',
          message: 'Please verify your email address',
        });
      case 'CodeMismatchException':
        return new BadRequestException({
          code: 'INVALID_CODE',
          message: 'Invalid verification code',
        });
      case 'ExpiredCodeException':
        return new BadRequestException({
          code: 'EXPIRED_CODE',
          message: 'Verification code has expired, please request a new one',
        });
      case 'InvalidPasswordException':
        return new BadRequestException({ code: 'INVALID_PASSWORD', message });
      case 'InvalidParameterException':
        return new BadRequestException({ code: 'INVALID_PARAMETER', message });
      case 'LimitExceededException':
      case 'TooManyRequestsException':
      case 'TooManyFailedAttemptsException':
        return new HttpException(
          {
            code: 'TOO_MANY_REQUESTS',
            message: 'Too many attempts, please try again later',
          },
          HttpStatus.TOO_MANY_REQUESTS,
        );
      default:
        this.logger.error(`Cognito error ${name}: ${message}`);
        return new InternalServerErrorException('Authentication service error');
    }
  }
}
