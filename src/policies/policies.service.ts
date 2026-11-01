import { BadRequestException, Injectable } from '@nestjs/common';
import { PolicyCategory, Prisma, User } from '@prisma/client';
import { addDays, parseDate, today } from '../common/utils/dates';
import { PrismaService } from '../prisma/prisma.service';
import {
  CreatePolicyDto,
  ListPoliciesQuery,
  PolicyMemberDto,
  UpdatePolicyDto,
} from './dto/policies.dto';
import { findOwned, findVisible, visibleTo } from './policy-access';
import {
  PolicySharesService,
  ShareTarget,
  toShareData,
} from './policy-shares.service';
import { policyInclude, PolicyView, toPolicyView } from './policy-view';

/** "Renewals due soon" on the dashboard covers this many days. */
export const RENEWAL_WINDOW_DAYS = 30;

export class DashboardSummary {
  /** Non-expired policies the user owns or can view. */
  activeCount: number;
  /** Of those, how many expire within 30 days. */
  renewalsDueCount: number;
  /** Active policies the user owns and has shared with someone. */
  sharedByMeCount: number;
  /** Active policies other people have shared with the user. */
  sharedWithMeCount: number;
  /** Sum of sumInsured across active policies, in rupees. */
  totalCover: number;
  byCategory: Record<PolicyCategory, number>;
}

const withShares = {
  ...policyInclude,
  shares: { include: { user: true }, orderBy: { createdAt: 'asc' } },
} satisfies Prisma.PolicyInclude;

@Injectable()
export class PoliciesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly shares: PolicySharesService,
  ) {}

  async create(owner: User, dto: CreatePolicyDto): Promise<PolicyView> {
    assertDateOrder(dto.startDate, dto.expiryDate);

    // Resolve every share first so a bad one rejects the whole request. The same person
    // listed twice (e.g. by email and by mobile) gets one share.
    const targets = new Map<string, ShareTarget>();
    for (const share of dto.shares ?? []) {
      const target = await this.shares.resolveTarget(owner, share);
      targets.set(
        'user' in target ? target.user.id : target.inviteEmail,
        target,
      );
    }

    const policy = await this.prisma.policy.create({
      data: {
        ownerId: owner.id,
        category: dto.category,
        provider: dto.provider,
        policyNumber: dto.policyNumber,
        notes: dto.notes ?? null,
        sumInsured: dto.sumInsured,
        premiumAmount: dto.premiumAmount,
        premiumFrequency: dto.premiumFrequency,
        startDate: parseDate(dto.startDate),
        expiryDate: parseDate(dto.expiryDate),
        members: { create: dto.members.map(toMemberData) },
        shares: { create: [...targets.values()].map(toShareData) },
      },
      include: withShares,
    });
    return toPolicyView(policy, owner.id);
  }

  async list(user: User, query: ListPoliciesQuery): Promise<PolicyView[]> {
    await this.shares.claimPending(user);
    const scope: Prisma.PolicyWhereInput =
      query.scope === 'owned'
        ? { ownerId: user.id }
        : query.scope === 'shared'
          ? { shares: { some: { userId: user.id } } }
          : visibleTo(user.id);
    const policies = await this.prisma.policy.findMany({
      where: {
        AND: [
          scope,
          query.category ? { category: query.category } : {},
          query.state === 'active' ? { expiryDate: { gte: today() } } : {},
          query.state === 'expired' ? { expiryDate: { lt: today() } } : {},
        ],
      },
      include: policyInclude,
      orderBy: { createdAt: 'desc' },
    });
    return policies.map((p) => toPolicyView(p, user.id));
  }

  /** Non-expired policies expiring within the window, soonest first. */
  async renewals(user: User, withinDays: number): Promise<PolicyView[]> {
    await this.shares.claimPending(user);
    const start = today();
    const policies = await this.prisma.policy.findMany({
      where: {
        ...visibleTo(user.id),
        expiryDate: { gte: start, lte: addDays(start, withinDays) },
      },
      include: policyInclude,
      orderBy: [{ expiryDate: 'asc' }, { createdAt: 'asc' }],
    });
    return policies.map((p) => toPolicyView(p, user.id));
  }

  async get(user: User, id: string): Promise<PolicyView> {
    await this.shares.claimPending(user);
    const policy = await findVisible(this.prisma, id, user.id);
    if (policy.ownerId !== user.id) return toPolicyView(policy, user.id);
    return this.getOwned(user, id);
  }

  async update(
    owner: User,
    id: string,
    dto: UpdatePolicyDto,
  ): Promise<PolicyView> {
    const existing = await findOwned(this.prisma, id, owner.id);

    // PartialType lets null through @IsOptional; only notes may be cleared.
    const blanked = Object.entries(dto)
      .filter(([key, value]) => value === null && key !== 'notes')
      .map(([key]) => `${key} must not be empty`);
    if (blanked.length) throw new BadRequestException(blanked);

    assertDateOrder(
      dto.startDate ?? existing.startDate,
      dto.expiryDate ?? existing.expiryDate,
    );

    await this.prisma.policy.update({
      where: { id },
      data: {
        category: dto.category,
        provider: dto.provider,
        policyNumber: dto.policyNumber,
        notes: dto.notes,
        sumInsured: dto.sumInsured,
        premiumAmount: dto.premiumAmount,
        premiumFrequency: dto.premiumFrequency,
        startDate: dto.startDate && parseDate(dto.startDate),
        expiryDate: dto.expiryDate && parseDate(dto.expiryDate),
        members: dto.members && {
          deleteMany: {},
          create: dto.members.map(toMemberData),
        },
      },
    });
    return this.getOwned(owner, id);
  }

  async remove(owner: User, id: string) {
    await findOwned(this.prisma, id, owner.id);
    await this.prisma.policy.delete({ where: { id } });
  }

  async dashboard(user: User): Promise<DashboardSummary> {
    await this.shares.claimPending(user);
    const start = today();
    const renewBy = addDays(start, RENEWAL_WINDOW_DAYS);
    const policies = await this.prisma.policy.findMany({
      where: { ...visibleTo(user.id), expiryDate: { gte: start } },
      select: {
        ownerId: true,
        category: true,
        sumInsured: true,
        expiryDate: true,
        _count: { select: { shares: true } },
      },
    });

    const byCategory = Object.fromEntries(
      Object.values(PolicyCategory).map((c) => [c, 0]),
    ) as Record<PolicyCategory, number>;
    let totalCover = new Prisma.Decimal(0);
    for (const p of policies) {
      byCategory[p.category]++;
      totalCover = totalCover.add(p.sumInsured);
    }
    const owned = policies.filter((p) => p.ownerId === user.id);

    return {
      activeCount: policies.length,
      renewalsDueCount: policies.filter((p) => p.expiryDate <= renewBy).length,
      sharedByMeCount: owned.filter((p) => p._count.shares > 0).length,
      sharedWithMeCount: policies.length - owned.length,
      totalCover: totalCover.toNumber(),
      byCategory,
    };
  }

  private async getOwned(owner: User, id: string): Promise<PolicyView> {
    const policy = await this.prisma.policy.findUniqueOrThrow({
      where: { id },
      include: withShares,
    });
    return toPolicyView(policy, owner.id);
  }
}

function toMemberData(m: PolicyMemberDto) {
  return {
    fullName: m.fullName,
    relationship: m.relationship,
    dateOfBirth: m.dateOfBirth ? parseDate(m.dateOfBirth) : null,
  };
}

function assertDateOrder(start: string | Date, expiry: string | Date) {
  const s = typeof start === 'string' ? parseDate(start) : start;
  const e = typeof expiry === 'string' ? parseDate(expiry) : expiry;
  if (e <= s) {
    throw new BadRequestException({
      code: 'INVALID_DATES',
      message: 'expiryDate must be after startDate',
    });
  }
}
