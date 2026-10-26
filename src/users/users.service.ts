import {
  BadRequestException,
  ConflictException,
  Injectable,
} from '@nestjs/common';
import { CognitoService } from '../cognito/cognito.service';
import { AuthUser } from '../auth/cognito-jwt.guard';
import { PrismaService } from '../prisma/prisma.service';
import { ChangePasswordDto, UpdateProfileDto } from './dto/users.dto';
import { toProfile, UserProfile } from './user-profile';

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cognito: CognitoService,
  ) {}

  async updateProfile(
    user: AuthUser,
    dto: UpdateProfileDto,
  ): Promise<UserProfile> {
    const attributes: Record<string, string> = {};
    const data: { fullName?: string; mobile?: string; pendingEmail?: string } =
      {};

    if (dto.fullName && dto.fullName !== user.fullName) {
      attributes.name = dto.fullName;
      data.fullName = dto.fullName;
    }

    if (dto.mobile && dto.mobile !== user.mobile) {
      await this.assertUnused({ mobile: dto.mobile }, user.id, 'MOBILE_EXISTS');
      attributes.phone_number = dto.mobile;
      data.mobile = dto.mobile;
    }

    if (dto.email && dto.email !== user.email) {
      await this.assertUnused({ email: dto.email }, user.id, 'EMAIL_EXISTS');
      attributes.email = dto.email;
      data.pendingEmail = dto.email;
    }

    if (Object.keys(attributes).length === 0) {
      return toProfile(user);
    }

    // Cognito first: if it rejects the change, the DB stays untouched.
    await this.cognito.updateAttributes(user.cognitoSub, attributes);
    const updated = await this.prisma.user.update({
      where: { id: user.id },
      data,
    });
    return toProfile(updated);
  }

  async verifyEmail(user: AuthUser, code: string): Promise<UserProfile> {
    if (!user.pendingEmail) {
      throw new BadRequestException({
        code: 'NO_PENDING_EMAIL',
        message: 'There is no email change waiting for verification',
      });
    }
    await this.cognito.verifyEmail(user.accessToken, code);
    const updated = await this.prisma.user.update({
      where: { id: user.id },
      data: { email: user.pendingEmail, pendingEmail: null },
    });
    return toProfile(updated);
  }

  changePassword(user: AuthUser, dto: ChangePasswordDto): Promise<void> {
    return this.cognito.changePassword(
      user.accessToken,
      dto.currentPassword,
      dto.newPassword,
    );
  }

  private async assertUnused(
    where: { email: string } | { mobile: string },
    selfId: string,
    code: 'EMAIL_EXISTS' | 'MOBILE_EXISTS',
  ) {
    const other = await this.prisma.user.findFirst({
      where: { ...where, NOT: { id: selfId } },
    });
    if (other) {
      throw new ConflictException({
        code,
        message:
          code === 'EMAIL_EXISTS'
            ? 'This email is already used by another account'
            : 'This mobile number is already used by another account',
      });
    }
  }
}
