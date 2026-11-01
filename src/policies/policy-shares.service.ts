import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, User } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateShareDto, MAX_SHARES } from './dto/policies.dto';
import { findOwned, policyNotFound } from './policy-access';
import { ShareView, toShareView } from './policy-view';

/** Who a share points at: an existing account, or an email that hasn't signed up yet. */
export type ShareTarget = { user: User } | { inviteEmail: string };

const alreadyShared = () =>
  new ConflictException({
    code: 'ALREADY_SHARED',
    message: 'This policy is already shared with that person',
  });

@Injectable()
export class PolicySharesService {
  constructor(private readonly prisma: PrismaService) {}

  async list(owner: User, policyId: string): Promise<ShareView[]> {
    await findOwned(this.prisma, policyId, owner.id);
    const shares = await this.prisma.policyShare.findMany({
      where: { policyId },
      include: { user: true },
      orderBy: { createdAt: 'asc' },
    });
    return shares.map(toShareView);
  }

  async add(
    owner: User,
    policyId: string,
    dto: CreateShareDto,
  ): Promise<ShareView> {
    await findOwned(this.prisma, policyId, owner.id);
    const target = await this.resolveTarget(owner, dto);

    const existing = await this.prisma.policyShare.findMany({
      where: { policyId },
    });
    if (existing.length >= MAX_SHARES) {
      throw new BadRequestException({
        code: 'SHARE_LIMIT_REACHED',
        message: `A policy can be shared with at most ${MAX_SHARES} people`,
      });
    }
    if (existing.some((s) => matches(s, target))) throw alreadyShared();

    try {
      const share = await this.prisma.policyShare.create({
        data: { policyId, ...toShareData(target) },
        include: { user: true },
      });
      return toShareView(share);
    } catch (e) {
      if (isUniqueViolation(e)) throw alreadyShared();
      throw e;
    }
  }

  async revoke(owner: User, policyId: string, shareId: string) {
    await findOwned(this.prisma, policyId, owner.id);
    const { count } = await this.prisma.policyShare.deleteMany({
      where: { id: shareId, policyId },
    });
    if (count === 0) {
      throw new NotFoundException({
        code: 'SHARE_NOT_FOUND',
        message: 'Share not found',
      });
    }
  }

  /** A viewer removes a policy someone shared with them from their own list. */
  async leave(user: User, policyId: string) {
    const { count } = await this.prisma.policyShare.deleteMany({
      where: { policyId, userId: user.id },
    });
    if (count === 0) throw policyNotFound();
  }

  /**
   * Turns email invites sent before this user signed up into real shares. Safe to key on
   * email because Cognito only lets users sign in once their email is verified.
   */
  async claimPending(user: User) {
    const pending = await this.prisma.policyShare.findMany({
      where: { userId: null, inviteEmail: user.email },
    });
    for (const share of pending) {
      try {
        await this.prisma.policyShare.update({
          where: { id: share.id },
          data: { userId: user.id, inviteEmail: null },
        });
      } catch (e) {
        // Already shared with them another way (e.g. by mobile): drop the duplicate invite.
        if (!isUniqueViolation(e)) throw e;
        await this.prisma.policyShare.delete({ where: { id: share.id } });
      }
    }
  }

  async resolveTarget(owner: User, dto: CreateShareDto): Promise<ShareTarget> {
    if (dto.email !== undefined && dto.mobile !== undefined) {
      throw new BadRequestException({
        code: 'INVALID_SHARE_TARGET',
        message: 'Send either email or mobile, not both',
      });
    }

    let user: User | null;
    if (dto.email !== undefined) {
      user = await this.prisma.user.findUnique({ where: { email: dto.email } });
      if (!user) return { inviteEmail: dto.email };
    } else {
      // Mobiles aren't verified, so a pending mobile invite could be claimed by whoever
      // registers that number. Only allow existing accounts.
      user = await this.prisma.user.findUnique({
        where: { mobile: dto.mobile },
      });
      if (!user) {
        throw new NotFoundException({
          code: 'NO_ACCOUNT_FOR_MOBILE',
          message:
            'No PolicyValet account uses this mobile number. Share by email to invite them.',
        });
      }
    }

    if (user.id === owner.id) {
      throw new BadRequestException({
        code: 'CANNOT_SHARE_WITH_SELF',
        message: 'You already own this policy',
      });
    }
    return { user };
  }
}

export function toShareData(target: ShareTarget) {
  return 'user' in target
    ? { userId: target.user.id }
    : { inviteEmail: target.inviteEmail };
}

/** Whether an existing share already covers the target, including a pending invite to their email. */
function matches(
  share: { userId: string | null; inviteEmail: string | null },
  target: ShareTarget,
): boolean {
  return 'user' in target
    ? share.userId === target.user.id || share.inviteEmail === target.user.email
    : share.inviteEmail === target.inviteEmail;
}

function isUniqueViolation(e: unknown): boolean {
  return (
    e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002'
  );
}
