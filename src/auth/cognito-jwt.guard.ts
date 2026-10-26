import {
  CanActivate,
  createParamDecorator,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { User } from '@prisma/client';
import { Request } from 'express';
import { CognitoService } from '../cognito/cognito.service';
import { PrismaService } from '../prisma/prisma.service';

export interface AuthUser extends User {
  accessToken: string;
}

type AuthedRequest = Request & { user?: AuthUser };

/** Verifies the Cognito access token and loads the matching profile into req.user. */
@Injectable()
export class CognitoJwtGuard implements CanActivate {
  constructor(
    private readonly cognito: CognitoService,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<AuthedRequest>();
    const [scheme, token] = (req.headers.authorization ?? '').split(' ');
    if (scheme !== 'Bearer' || !token) {
      throw new UnauthorizedException('Missing bearer token');
    }

    const sub = await this.cognito.verifyAccessToken(token);
    const user = await this.prisma.user.findUnique({
      where: { cognitoSub: sub },
    });
    if (!user) {
      throw new UnauthorizedException('User not found');
    }

    req.user = { ...user, accessToken: token };
    return true;
  }
}

export const CurrentUser = createParamDecorator(
  (_: unknown, ctx: ExecutionContext): AuthUser =>
    ctx.switchToHttp().getRequest<AuthedRequest>().user as AuthUser,
);
