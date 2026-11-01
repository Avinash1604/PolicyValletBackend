import { applyDecorators } from '@nestjs/common';
import { Transform } from 'class-transformer';
import {
  IsEmail,
  IsISO8601,
  IsNumber,
  IsPhoneNumber,
  IsPositive,
  IsString,
  Matches,
  Max,
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

/** Trimmed, non-empty text up to `max` characters. */
export const IsText = (max: number) =>
  applyDecorators(
    Transform(({ value }: { value: unknown }) =>
      typeof value === 'string' ? value.trim() : value,
    ),
    IsString(),
    MinLength(1, { message: '$property must not be empty' }),
    MaxLength(max),
  );

/** A calendar date as "YYYY-MM-DD". */
export const IsDateOnly = () =>
  applyDecorators(
    Matches(/^\d{4}-\d{2}-\d{2}$/, {
      message: '$property must be a date in YYYY-MM-DD format',
    }),
    IsISO8601(
      { strict: true },
      { message: '$property must be a valid calendar date' },
    ),
  );

/** A positive money amount with at most 2 decimals, below `max` (the column's limit). */
export const IsAmount = (max: number) =>
  applyDecorators(
    IsNumber(
      { maxDecimalPlaces: 2, allowNaN: false, allowInfinity: false },
      { message: '$property must be a number with at most 2 decimal places' },
    ),
    IsPositive(),
    Max(max),
  );
