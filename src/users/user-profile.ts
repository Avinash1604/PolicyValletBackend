import { User } from '@prisma/client';

export class UserProfile {
  id: string;
  fullName: string;
  email: string;
  /** New email waiting for its verification code, if any. */
  pendingEmail: string | null;
  mobile: string;
  createdAt: Date;
  updatedAt: Date;
}

export function toProfile(user: User): UserProfile {
  return {
    id: user.id,
    fullName: user.fullName,
    email: user.email,
    pendingEmail: user.pendingEmail,
    mobile: user.mobile,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
  };
}
