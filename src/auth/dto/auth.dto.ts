import { Transform } from 'class-transformer';
import { IsNotEmpty, IsString, Matches } from 'class-validator';
import { Match } from '../../common/decorators/match.decorator';
import {
  IsFullName,
  IsMobile,
  IsNormalizedEmail,
  IsStrongPassword,
} from '../../common/decorators/validators';

const IsCode = () =>
  Matches(/^\d{6}$/, {
    message: 'code must be the 6-digit code from the email',
  });

export class RegisterDto {
  /** @example "Ravi Kumar" */
  @IsFullName()
  fullName: string;

  /** @example "ravi@example.com" */
  @IsNormalizedEmail()
  email: string;

  /** Any common format; stored as E.164. @example "9876543210" */
  @IsMobile()
  mobile: string;

  /** Min 8 chars with an uppercase letter, a lowercase letter and a number. @example "Secret123" */
  @IsStrongPassword()
  password: string;

  /** @example "Secret123" */
  @Match('password', { message: 'Passwords do not match' })
  confirmPassword: string;
}

export class ConfirmSignUpDto {
  @IsNormalizedEmail()
  email: string;

  /** @example "123456" */
  @IsCode()
  code: string;
}

export class EmailDto {
  @IsNormalizedEmail()
  email: string;
}

export class LoginDto {
  /** Email address or mobile number. @example "ravi@example.com" */
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @IsNotEmpty()
  identifier: string;

  @IsString()
  @IsNotEmpty()
  password: string;
}

export class RefreshDto {
  @IsString()
  @IsNotEmpty()
  refreshToken: string;
}

export class ResetPasswordDto {
  @IsNormalizedEmail()
  email: string;

  /** @example "123456" */
  @IsCode()
  code: string;

  @IsStrongPassword()
  newPassword: string;

  @Match('newPassword', { message: 'Passwords do not match' })
  confirmPassword: string;
}
