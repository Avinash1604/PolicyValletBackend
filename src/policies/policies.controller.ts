import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { AuthUser } from '../auth/cognito-jwt.guard';
import { CognitoJwtGuard, CurrentUser } from '../auth/cognito-jwt.guard';
import {
  CreatePolicyDto,
  ListPoliciesQuery,
  RenewalsQuery,
  UpdatePolicyDto,
} from './dto/policies.dto';
import { DashboardSummary, PoliciesService } from './policies.service';
import { PolicyView } from './policy-view';

@ApiTags('policies')
@ApiBearerAuth()
@UseGuards(CognitoJwtGuard)
@Controller('policies')
export class PoliciesController {
  constructor(private readonly policies: PoliciesService) {}

  /** Saves a complete policy from the "Add policy" wizard, optionally sharing it. */
  @Post()
  create(
    @CurrentUser() user: AuthUser,
    @Body() dto: CreatePolicyDto,
  ): Promise<PolicyView> {
    return this.policies.create(user, dto);
  }

  /** My policies and the ones shared with me, newest first. */
  @Get()
  list(
    @CurrentUser() user: AuthUser,
    @Query() query: ListPoliciesQuery,
  ): Promise<PolicyView[]> {
    return this.policies.list(user, query);
  }

  /** Policies expiring within `withinDays` (default 30), soonest first. */
  @Get('renewals')
  renewals(
    @CurrentUser() user: AuthUser,
    @Query() query: RenewalsQuery,
  ): Promise<PolicyView[]> {
    return this.policies.renewals(user, query.withinDays);
  }

  @Get(':id')
  get(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
  ): Promise<PolicyView> {
    return this.policies.get(user, id);
  }

  /** Owner only. */
  @Patch(':id')
  update(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: UpdatePolicyDto,
  ): Promise<PolicyView> {
    return this.policies.update(user, id, dto);
  }

  /** Owner only. Also removes it for everyone it was shared with. */
  @Delete(':id')
  async remove(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    await this.policies.remove(user, id);
    return { success: true };
  }
}

@ApiTags('policies')
@ApiBearerAuth()
@UseGuards(CognitoJwtGuard)
@Controller('dashboard')
export class DashboardController {
  constructor(private readonly policies: PoliciesService) {}

  /** Numbers for the home screen. */
  @Get()
  summary(@CurrentUser() user: AuthUser): Promise<DashboardSummary> {
    return this.policies.dashboard(user);
  }
}
