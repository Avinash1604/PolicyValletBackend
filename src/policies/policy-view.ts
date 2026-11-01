import {
  Policy,
  PolicyCategory,
  PolicyMember,
  PolicyShare,
  PremiumFrequency,
  Prisma,
  Relationship,
  User,
} from '@prisma/client';
import { daysBetween, formatDate, today } from '../common/utils/dates';

/** What every policy query loads alongside the policy. */
export const policyInclude = {
  owner: { select: { id: true, fullName: true } },
  members: { orderBy: [{ relationship: 'asc' }, { fullName: 'asc' }] },
} satisfies Prisma.PolicyInclude;

export type ShareWithUser = PolicyShare & { user: User | null };

export type PolicyWithRelations = Policy & {
  owner: Pick<User, 'id' | 'fullName'>;
  members: PolicyMember[];
  shares?: ShareWithUser[];
};

export class PolicyMemberView {
  id: string;
  fullName: string;
  relationship: Relationship;
  dateOfBirth: string | null;
}

export class ShareView {
  id: string;
  /** ACTIVE once the person has an account; PENDING while an email invite waits for sign-up. */
  status: 'ACTIVE' | 'PENDING';
  email: string;
  /** null while pending. */
  fullName: string | null;
  createdAt: Date;
}

export class PolicyView {
  id: string;
  category: PolicyCategory;
  provider: string;
  policyNumber: string;
  notes: string | null;
  sumInsured: number;
  premiumAmount: number;
  premiumFrequency: PremiumFrequency;
  startDate: string;
  expiryDate: string;
  /** EXPIRED once expiryDate has passed (in India time). */
  state: 'ACTIVE' | 'EXPIRED';
  /** Negative when expired. */
  daysToExpiry: number;
  /** OWNER can edit, delete and share; VIEWER can only read. */
  access: 'OWNER' | 'VIEWER';
  owner: { id: string; fullName: string };
  members: PolicyMemberView[];
  /** Only returned to the owner, on the detail and create/update responses. */
  shares?: ShareView[];
  createdAt: Date;
  updatedAt: Date;
}

export function toShareView(share: ShareWithUser): ShareView {
  return {
    id: share.id,
    status: share.user ? 'ACTIVE' : 'PENDING',
    email: share.user?.email ?? share.inviteEmail ?? '',
    fullName: share.user?.fullName ?? null,
    createdAt: share.createdAt,
  };
}

export function toPolicyView(
  policy: PolicyWithRelations,
  viewerId: string,
): PolicyView {
  const daysToExpiry = daysBetween(today(), policy.expiryDate);
  const isOwner = policy.ownerId === viewerId;
  return {
    id: policy.id,
    category: policy.category,
    provider: policy.provider,
    policyNumber: policy.policyNumber,
    notes: policy.notes,
    sumInsured: policy.sumInsured.toNumber(),
    premiumAmount: policy.premiumAmount.toNumber(),
    premiumFrequency: policy.premiumFrequency,
    startDate: formatDate(policy.startDate),
    expiryDate: formatDate(policy.expiryDate),
    state: daysToExpiry < 0 ? 'EXPIRED' : 'ACTIVE',
    daysToExpiry,
    access: isOwner ? 'OWNER' : 'VIEWER',
    owner: policy.owner,
    members: policy.members.map((m) => ({
      id: m.id,
      fullName: m.fullName,
      relationship: m.relationship,
      dateOfBirth: m.dateOfBirth ? formatDate(m.dateOfBirth) : null,
    })),
    ...(isOwner && policy.shares
      ? { shares: policy.shares.map(toShareView) }
      : {}),
    createdAt: policy.createdAt,
    updatedAt: policy.updatedAt,
  };
}
