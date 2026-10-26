import { applyDecorators } from '@nestjs/common';
import { Transform } from 'class-transformer';
import {
  IsEmail,
  IsPhoneNumber,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';
import { toE164 } from '../utils/phone';

// Must stay in sync with the Cognito password policy in infra/lib/base-stack.ts.
export const IsStrongPassword = () =>
  applyDecorators(
    IsString(),
    MinLength(8),
    MaxLength(128),
    Matches(/(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/, {
      message:
        'password must contain at least one uppercase letter, one lowercase letter and one number',
    }),
  );

export const IsNormalizedEmail = () =>
  applyDecorators(
    Transform(({ value }: { value: unknown }) =>
      typeof value === 'string' ? value.trim().toLowerCase() : value,
    ),
    IsEmail({}, { message: 'email must be a valid email address' }),
  );

export const IsMobile = () =>
  applyDecorators(
    Transform(({ value }: { value: unknown }) =>
      typeof value === 'string' ? (toE164(value) ?? value) : value,
    ),
    IsPhoneNumber(undefined, {
      message: 'mobile must be a valid mobile number',
    }),
  );

export const IsFullName = () =>
  applyDecorators(
    Transform(({ value }: { value: unknown }) =>
      typeof value === 'string' ? value.trim() : value,
    ),
    IsString(),
    MinLength(2),
    MaxLength(100),
  );
