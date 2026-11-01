import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { policyInclude } from './policy-view';

export const policyNotFound = () =>
  new NotFoundException({
    code: 'POLICY_NOT_FOUND',
    message: 'Policy not found',
  });

/** Policies the user owns or that are shared with them. */
export const visibleTo = (userId: string): Prisma.PolicyWhereInput => ({
  OR: [{ ownerId: userId }, { shares: { some: { userId } } }],
});

/**
 * Loads a policy the user can see. Someone it isn't shared with gets 404, so they
 * can't tell it exists.
 */
export async function findVisible(
  prisma: PrismaService,
  id: string,
  userId: string,
) {
  const policy = await prisma.policy.findFirst({
    where: { id, ...visibleTo(userId) },
    include: policyInclude,
  });
  if (!policy) throw policyNotFound();
  return policy;
}

/** Like findVisible, but viewers get 403: only the owner may change a policy. */
export async function findOwned(
  prisma: PrismaService,
  id: string,
  userId: string,
) {
  const policy = await findVisible(prisma, id, userId);
  if (policy.ownerId !== userId) {
    throw new ForbiddenException({
      code: 'NOT_POLICY_OWNER',
      message: 'Only the owner can change this policy',
    });
  }
  return policy;
}
