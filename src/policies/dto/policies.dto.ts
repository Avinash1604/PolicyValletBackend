import { OmitType, PartialType } from '@nestjs/swagger';
import { PolicyCategory, PremiumFrequency, Relationship } from '@prisma/client';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsEnum,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import {
  IsAmount,
  IsDateOnly,
  IsFullName,
  IsMobile,
  IsNormalizedEmail,
  IsText,
} from '../../common/decorators/validators';

export const MAX_MEMBERS = 20;
export const MAX_SHARES = 20;

export class PolicyMemberDto {
  @IsFullName()
  fullName: string;

  @IsEnum(Relationship)
  relationship: Relationship;

  /** @example "1990-05-14" */
  @IsOptional()
  @IsDateOnly()
  dateOfBirth?: string;
}

/** Who to share with: send exactly one of email or mobile. */
export class CreateShareDto {
  /** Works even if they haven't signed up yet; they'll see the policy once they do. */
  @ValidateIf((o: CreateShareDto) => o.mobile === undefined)
  @IsNormalizedEmail()
  email?: string;

  /** Must belong to an existing PolicyValet account. */
  @ValidateIf((o: CreateShareDto) => o.email === undefined)
  @IsMobile()
  mobile?: string;
}

/** The whole "Add policy" wizard in one request; every step's mandatory fields are required. */
export class CreatePolicyDto {
  @IsEnum(PolicyCategory)
  category: PolicyCategory;

  /** @example "HDFC Ergo" */
  @IsText(100)
  provider: string;

  /** @example "HE-HOME-330298" */
  @IsText(50)
  policyNumber: string;

  /** Empty or null clears it. */
  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() || null : value,
  )
  @IsString()
  @MaxLength(1000)
  notes?: string | null;

  /** Cover amount in rupees. @example 500000 */
  @IsAmount(999_999_999_999)
  sumInsured: number;

  /** @example 12500 */
  @IsAmount(9_999_999_999)
  premiumAmount: number;

  @IsEnum(PremiumFrequency)
  premiumFrequency: PremiumFrequency;

  /** @example "2025-09-27" */
  @IsDateOnly()
  startDate: string;

  /** Renewal/expiry date; must be after startDate. @example "2026-09-26" */
  @IsDateOnly()
  expiryDate: string;

  /** People covered by the policy. */
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(MAX_MEMBERS)
  @ValidateNested({ each: true })
  @Type(() => PolicyMemberDto)
  members: PolicyMemberDto[];

  /** Family members to share with (view-only). */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_SHARES)
  @ValidateNested({ each: true })
  @Type(() => CreateShareDto)
  shares?: CreateShareDto[];
}

/** Send only what changed. `members`, if sent, replaces the whole list. Shares have their own endpoints. */
export class UpdatePolicyDto extends PartialType(
  OmitType(CreatePolicyDto, ['shares'] as const),
) {}

export class ListPoliciesQuery {
  /** owned: mine; shared: shared with me; all: both. */
  @IsOptional()
  @IsIn(['all', 'owned', 'shared'])
  scope: 'all' | 'owned' | 'shared' = 'all';

  @IsOptional()
  @IsEnum(PolicyCategory)
  category?: PolicyCategory;

  @IsOptional()
  @IsIn(['active', 'expired'])
  state?: 'active' | 'expired';
}

export class RenewalsQuery {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(365)
  withinDays: number = 30;
}
