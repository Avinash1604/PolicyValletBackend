import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpStatus,
  InternalServerErrorException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CognitoService } from './cognito.service';

describe('CognitoService error mapping', () => {
  const config = new ConfigService({
    aws: { region: 'ap-south-1' },
    cognito: { userPoolId: 'ap-south-1_TestPool1', clientId: 'client' },
  });

  const failingWith = (name: string) => {
    const service = new CognitoService(config);
    const send = jest
      .fn()
      .mockRejectedValue(Object.assign(new Error(name), { name }));
    Object.assign(service, { client: { send } });
    return service;
  };

  it.each([
    ['UsernameExistsException', ConflictException],
    ['NotAuthorizedException', UnauthorizedException],
    ['UserNotConfirmedException', ForbiddenException],
    ['CodeMismatchException', BadRequestException],
    ['ExpiredCodeException', BadRequestException],
    ['InvalidPasswordException', BadRequestException],
    ['SomethingUnexpected', InternalServerErrorException],
  ])('maps %s', async (name, expected) => {
    await expect(
      failingWith(name).login('a@b.com', 'x'),
    ).rejects.toBeInstanceOf(expected);
  });

  it('maps throttling errors to 429', async () => {
    await expect(
      failingWith('LimitExceededException').forgotPassword('a@b.com'),
    ).rejects.toMatchObject({ status: HttpStatus.TOO_MANY_REQUESTS });
  });

  it('returns tokens from a successful login', async () => {
    const service = new CognitoService(config);
    const send = jest.fn().mockResolvedValue({
      AuthenticationResult: {
        AccessToken: 'a',
        IdToken: 'i',
        RefreshToken: 'r',
        ExpiresIn: 3600,
        TokenType: 'Bearer',
      },
    });
    Object.assign(service, { client: { send } });

    await expect(service.login('a@b.com', 'x')).resolves.toEqual({
      accessToken: 'a',
      idToken: 'i',
      refreshToken: 'r',
      expiresIn: 3600,
      tokenType: 'Bearer',
    });
  });
});
