import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { AuthUser } from '../auth/cognito-jwt.guard';
import { CognitoJwtGuard, CurrentUser } from '../auth/cognito-jwt.guard';
import {
  ChangePasswordDto,
  DeleteAccountDto,
  UpdateProfileDto,
  VerifyEmailDto,
} from './dto/users.dto';
import { toProfile, UserProfile } from './user-profile';
import { UsersService } from './users.service';

@ApiTags('users')
@ApiBearerAuth()
@UseGuards(CognitoJwtGuard)
@Controller('users/me')
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get()
  me(@CurrentUser() user: AuthUser): UserProfile {
    return toProfile(user);
  }

  /** Edit profile. Send only the fields that changed. */
  @Patch()
  update(@CurrentUser() user: AuthUser, @Body() dto: UpdateProfileDto) {
    return this.users.updateProfile(user, dto);
  }

  /** Confirms a changed email with the code sent to the new address. */
  @Post('verify-email')
  @HttpCode(200)
  verifyEmail(@CurrentUser() user: AuthUser, @Body() dto: VerifyEmailDto) {
    return this.users.verifyEmail(user, dto.code);
  }

  @Patch('password')
  async changePassword(
    @CurrentUser() user: AuthUser,
    @Body() dto: ChangePasswordDto,
  ) {
    await this.users.changePassword(user, dto);
    return { success: true };
  }

  /**
   * Permanently deletes the account, its sign-in and all of the user's policies.
   * Policies others shared with them are just unshared. Requires the current password.
   */
  @Delete()
  async deleteAccount(
    @CurrentUser() user: AuthUser,
    @Body() dto: DeleteAccountDto,
  ) {
    await this.users.deleteAccount(user, dto.password);
    return { success: true };
  }
}
