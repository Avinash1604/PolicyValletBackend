import {
  ForbiddenException,
  INestApplication,
  UnauthorizedException,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { CognitoService } from '../src/cognito/cognito.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { setupApp } from '../src/setup-app';

const tokens = {
  accessToken: 'access',
  idToken: 'id',
  refreshToken: 'refresh',
  expiresIn: 3600,
  tokenType: 'Bearer',
};

// Access tokens in these tests are "token-<sub>".
const cognito = {
  verifyAccessToken: jest.fn((token: string) =>
    token.startsWith('token-')
      ? Promise.resolve(token.slice('token-'.length))
      : Promise.reject(new UnauthorizedException()),
  ),
  signUp: jest.fn(),
  confirmSignUp: jest.fn(),
  resendConfirmationCode: jest.fn(),
  login: jest.fn(),
  refresh: jest.fn(),
  globalSignOut: jest.fn(),
  forgotPassword: jest.fn(),
  confirmForgotPassword: jest.fn(),
  changePassword: jest.fn(),
  updateAttributes: jest.fn(),
  verifyEmail: jest.fn(),
  deleteUser: jest.fn(),
};

const validRegistration = {
  fullName: '  Ravi Kumar ',
  email: 'Ravi@Example.com',
  mobile: '98765 43210',
  password: 'Secret123',
  confirmPassword: 'Secret123',
};

describe('PolicyValet API (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let sub = 0;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(CognitoService)
      .useValue(cognito)
      .compile();

    app = moduleRef.createNestApplication();
    setupApp(app);
    await app.init();
    prisma = app.get(PrismaService);
  });

  beforeEach(async () => {
    jest.clearAllMocks();
    await prisma.user.deleteMany();
    cognito.signUp.mockImplementation(() =>
      Promise.resolve({ sub: `sub-${++sub}` }),
    );
    cognito.login.mockResolvedValue(tokens);
  });

  afterAll(async () => {
    await app.close();
  });

  const register = (body: object = validRegistration) =>
    request(app.getHttpServer()).post('/v1/auth/register').send(body);

  const registered = async () => {
    const res = await register().expect(201);
    const user = await prisma.user.findUniqueOrThrow({
      where: { id: (res.body as { user: { id: string } }).user.id },
    });
    return { user, auth: `Bearer token-${user.cognitoSub}` };
  };

  it('GET /health reports the database is up', () =>
    request(app.getHttpServer())
      .get('/health')
      .expect(200, { status: 'ok', db: 'up' }));

  describe('register', () => {
    it('creates the user with normalized email and mobile', async () => {
      const res = await register().expect(201);

      expect(res.body).toMatchObject({
        user: {
          fullName: 'Ravi Kumar',
          email: 'ravi@example.com',
          mobile: '+919876543210',
        },
      });
      expect(res.body).not.toHaveProperty('user.cognitoSub');
      expect(cognito.signUp).toHaveBeenCalledWith(
        'ravi@example.com',
        'Secret123',
        'Ravi Kumar',
        '+919876543210',
      );
    });

    it.each([
      ['mismatched passwords', { confirmPassword: 'Other1234' }],
      ['weak password', { password: 'secret', confirmPassword: 'secret' }],
      ['invalid mobile', { mobile: '12' }],
      ['invalid email', { email: 'not-an-email' }],
      ['missing name', { fullName: '' }],
    ])('rejects %s with 400', async (_, override) => {
      await register({ ...validRegistration, ...override }).expect(400);
      expect(cognito.signUp).not.toHaveBeenCalled();
    });

    it('rejects a duplicate email or mobile with 409', async () => {
      await register().expect(201);

      const dupEmail = await register({
        ...validRegistration,
        mobile: '9123456789',
      }).expect(409);
      expect(dupEmail.body).toMatchObject({ code: 'EMAIL_EXISTS' });

      const dupMobile = await register({
        ...validRegistration,
        email: 'other@example.com',
        mobile: '+91 98765-43210',
      }).expect(409);
      expect(dupMobile.body).toMatchObject({ code: 'MOBILE_EXISTS' });
    });
  });

  describe('login', () => {
    const login = (identifier: string, password = 'Secret123') =>
      request(app.getHttpServer())
        .post('/v1/auth/login')
        .send({ identifier, password });

    it('accepts the email in any case', async () => {
      await registered();
      const res = await login('RAVI@example.com').expect(200);

      expect(res.body).toMatchObject({
        ...tokens,
        user: { email: 'ravi@example.com' },
      });
      expect(cognito.login).toHaveBeenCalledWith(
        'ravi@example.com',
        'Secret123',
      );
    });

    it('accepts the mobile number and signs in with the linked email', async () => {
      await registered();
      await login('+91 98765 43210').expect(200);
      expect(cognito.login).toHaveBeenCalledWith(
        'ravi@example.com',
        'Secret123',
      );
    });

    it('returns 401 for an unknown identifier without calling Cognito', async () => {
      await login('9000000000').expect(401);
      await login('nobody@example.com').expect(401);
      expect(cognito.login).not.toHaveBeenCalled();
    });

    it('passes through Cognito errors such as an unconfirmed email', async () => {
      await registered();
      cognito.login.mockRejectedValue(
        new ForbiddenException({ code: 'USER_NOT_CONFIRMED' }),
      );
      const res = await login('ravi@example.com').expect(403);
      expect(res.body).toMatchObject({ code: 'USER_NOT_CONFIRMED' });
    });
  });

  describe('password reset', () => {
    it('forgot-password returns 200 even when Cognito fails', async () => {
      cognito.forgotPassword.mockRejectedValue(new Error('boom'));
      await request(app.getHttpServer())
        .post('/v1/auth/forgot-password')
        .send({ email: 'unknown@example.com' })
        .expect(200, { success: true });
    });

    it('reset-password validates the code and password confirmation', async () => {
      const send = (body: object) =>
        request(app.getHttpServer()).post('/v1/auth/reset-password').send(body);
      const valid = {
        email: 'ravi@example.com',
        code: '123456',
        newPassword: 'NewSecret1',
        confirmPassword: 'NewSecret1',
      };

      await send({ ...valid, code: 'abc' }).expect(400);
      await send({ ...valid, confirmPassword: 'Nope12345' }).expect(400);
      await send(valid).expect(200);
      expect(cognito.confirmForgotPassword).toHaveBeenCalledWith(
        'ravi@example.com',
        '123456',
        'NewSecret1',
      );
    });
  });

  describe('profile', () => {
    it('requires a valid bearer token', async () => {
      await request(app.getHttpServer()).get('/v1/users/me').expect(401);
      await request(app.getHttpServer())
        .get('/v1/users/me')
        .set('Authorization', 'Bearer bad')
        .expect(401);
    });

    it('returns the current profile', async () => {
      const { auth } = await registered();
      const res = await request(app.getHttpServer())
        .get('/v1/users/me')
        .set('Authorization', auth)
        .expect(200);
      expect(res.body).toMatchObject({
        fullName: 'Ravi Kumar',
        pendingEmail: null,
      });
      expect(res.body).not.toHaveProperty('cognitoSub');
    });

    it('updates name and mobile in Cognito and the database', async () => {
      const { user, auth } = await registered();
      const res = await request(app.getHttpServer())
        .patch('/v1/users/me')
        .set('Authorization', auth)
        .send({ fullName: 'Ravi K', mobile: '9123456789' })
        .expect(200);

      expect(res.body).toMatchObject({
        fullName: 'Ravi K',
        mobile: '+919123456789',
      });
      expect(cognito.updateAttributes).toHaveBeenCalledWith(user.cognitoSub, {
        name: 'Ravi K',
        phone_number: '+919123456789',
      });
    });

    it('changes the email only after the code is verified', async () => {
      const { auth } = await registered();
      const patched = await request(app.getHttpServer())
        .patch('/v1/users/me')
        .set('Authorization', auth)
        .send({ email: 'new@example.com' })
        .expect(200);
      expect(patched.body).toMatchObject({
        email: 'ravi@example.com',
        pendingEmail: 'new@example.com',
      });

      const verified = await request(app.getHttpServer())
        .post('/v1/users/me/verify-email')
        .set('Authorization', auth)
        .send({ code: '123456' })
        .expect(200);
      expect(verified.body).toMatchObject({
        email: 'new@example.com',
        pendingEmail: null,
      });
    });

    it('rejects a mobile number used by another account', async () => {
      await registered();
      const other = await register({
        ...validRegistration,
        email: 'other@example.com',
        mobile: '9123456789',
      }).expect(201);
      const otherUser = await prisma.user.findUniqueOrThrow({
        where: { id: (other.body as { user: { id: string } }).user.id },
      });

      await request(app.getHttpServer())
        .patch('/v1/users/me')
        .set('Authorization', `Bearer token-${otherUser.cognitoSub}`)
        .send({ mobile: '9876543210' })
        .expect(409);
      expect(cognito.updateAttributes).not.toHaveBeenCalled();
    });

    it('changes the password through Cognito', async () => {
      const { user, auth } = await registered();
      await request(app.getHttpServer())
        .patch('/v1/users/me/password')
        .set('Authorization', auth)
        .send({
          currentPassword: 'Secret123',
          newPassword: 'NewSecret1',
          confirmPassword: 'NewSecret1',
        })
        .expect(200);
      expect(cognito.changePassword).toHaveBeenCalledWith(
        `token-${user.cognitoSub}`,
        'Secret123',
        'NewSecret1',
      );
    });
  });
});
