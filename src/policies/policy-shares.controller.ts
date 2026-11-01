import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { AuthUser } from '../auth/cognito-jwt.guard';
import { CognitoJwtGuard, CurrentUser } from '../auth/cognito-jwt.guard';
import { CreateShareDto } from './dto/policies.dto';
import { PolicySharesService } from './policy-shares.service';
import { ShareView } from './policy-view';

/** View-only sharing with family members. */
@ApiTags('policies')
@ApiBearerAuth()
@UseGuards(CognitoJwtGuard)
@Controller('policies/:id/shares')
export class PolicySharesController {
  constructor(private readonly shares: PolicySharesService) {}

  /** Owner only. */
  @Get()
  list(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
  ): Promise<ShareView[]> {
    return this.shares.list(user, id);
  }

  /** Owner only. Send `email` (works before they sign up) or `mobile` (existing accounts only). */
  @Post()
  add(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: CreateShareDto,
  ): Promise<ShareView> {
    return this.shares.add(user, id, dto);
  }

  /** For viewers: removes a policy shared with me from my list. Declared before :shareId. */
  @Delete('me')
  async leave(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    await this.shares.leave(user, id);
    return { success: true };
  }

  /** Owner only: stop sharing with this person. */
  @Delete(':shareId')
  async revoke(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Param('shareId') shareId: string,
  ) {
    await this.shares.revoke(user, id, shareId);
    return { success: true };
  }
}
