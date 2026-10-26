import { IsNotEmpty, IsOptional, IsString, Matches } from 'class-validator';
import { Match } from '../../common/decorators/match.decorator';
import {
  IsFullName,
  IsMobile,
  IsNormalizedEmail,
  IsStrongPassword,
} from '../../common/decorators/validators';

export class UpdateProfileDto {
  @IsOptional()
  @IsFullName()
  fullName?: string;

  /** Changing the email sends a code to the new address; it takes effect after /users/me/verify-email. */
  @IsOptional()
  @IsNormalizedEmail()
  email?: string;

  @IsOptional()
  @IsMobile()
  mobile?: string;
}

export class VerifyEmailDto {
  /** @example "123456" */
  @Matches(/^\d{6}$/, {
    message: 'code must be the 6-digit code from the email',
  })
  code: string;
}

export class ChangePasswordDto {
  @IsString()
  @IsNotEmpty()
  currentPassword: string;

  @IsStrongPassword()
  newPassword: string;

  @Match('newPassword', { message: 'Passwords do not match' })
  confirmPassword: string;
}
