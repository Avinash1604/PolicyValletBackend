import { INestApplication, UnauthorizedException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { CognitoService } from '../src/cognito/cognito.service';
import { addDays, formatDate, today } from '../src/common/utils/dates';
import { PrismaService } from '../src/prisma/prisma.service';
import { setupApp } from '../src/setup-app';

// Access tokens in these tests are "token-<sub>".
const cognito = {
  verifyAccessToken: jest.fn((token: string) =>
    token.startsWith('token-')
      ? Promise.resolve(token.slice('token-'.length))
      : Promise.reject(new UnauthorizedException()),
  ),
};

const inDays = (days: number) => formatDate(addDays(today(), days));

const validPolicy = () => ({
  category: 'HEALTH',
  provider: ' Star Health ',
  policyNumber: 'SH-1001',
  notes: 'Family floater',
  sumInsured: 500000,
  premiumAmount: 12500.5,
  premiumFrequency: 'YEARLY',
  startDate: inDays(-350),
  expiryDate: inDays(15),
  members: [
    { fullName: 'Kavya Kumar', relationship: 'SPOUSE' },
    { fullName: 'Ravi Kumar', relationship: 'SELF', dateOfBirth: '1990-05-14' },
  ],
});

describe('Policies (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;

  const seedUser = (name: string, mobile: string) =>
    prisma.user.create({
      data: {
        cognitoSub: name,
        fullName: `${name} Kumar`,
        email: `${name}@example.com`,
        mobile,
      },
    });

  const as = (sub: string) => ({ Authorization: `Bearer token-${sub}` });

  const createPolicy = async (owner: string, overrides = {}) => {
    const res = await request(app.getHttpServer())
      .post('/v1/policies')
      .set(as(owner))
      .send({ ...validPolicy(), ...overrides })
      .expect(201);
    return res.body as { id: string };
  };

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
    await prisma.user.deleteMany(); // cascades to policies, members and shares
    await seedUser('ravi', '+919876543210');
    await seedUser('kavya', '+919876543211');
    await seedUser('stranger', '+919876543212');
  });

  afterAll(async () => {
    await app.close();
  });

  describe('create', () => {
    it('saves the whole wizard in one call', async () => {
      const res = await request(app.getHttpServer())
        .post('/v1/policies')
        .set(as('ravi'))
        .send({ ...validPolicy(), shares: [{ email: 'Kavya@Example.com' }] })
        .expect(201);

      expect(res.body).toMatchObject({
        category: 'HEALTH',
        provider: 'Star Health',
        sumInsured: 500000,
        premiumAmount: 12500.5,
        expiryDate: inDays(15),
        state: 'ACTIVE',
        daysToExpiry: 15,
        access: 'OWNER',
        owner: { fullName: 'ravi Kumar' },
        shares: [
          {
            email: 'kavya@example.com',
            fullName: 'kavya Kumar',
            status: 'ACTIVE',
          },
        ],
      });
      // SELF sorts before SPOUSE.
      expect(res.body).toMatchObject({
        members: [
          { fullName: 'Ravi Kumar', dateOfBirth: '1990-05-14' },
          { fullName: 'Kavya Kumar', dateOfBirth: null },
        ],
      });
    });

    it.each([
      'category',
      'provider',
      'policyNumber',
      'sumInsured',
      'premiumAmount',
      'premiumFrequency',
      'startDate',
      'expiryDate',
      'members',
    ])('rejects a policy without %s', async (field) => {
      const body: Record<string, unknown> = validPolicy();
      delete body[field];
      const res = await request(app.getHttpServer())
        .post('/v1/policies')
        .set(as('ravi'))
        .send(body)
        .expect(400);
      expect(
        JSON.stringify((res.body as { message: string[] }).message),
      ).toContain(field);
    });

    it('rejects bad values', async () => {
      for (const overrides of [
        { members: [] },
        { provider: '   ' },
        { sumInsured: -5 },
        { premiumAmount: 10.123 },
        { startDate: '2026-02-30' },
        { expiryDate: '26/09/2026' },
        { category: 'PET' },
      ]) {
        await request(app.getHttpServer())
          .post('/v1/policies')
          .set(as('ravi'))
          .send({ ...validPolicy(), ...overrides })
          .expect(400);
      }
      expect(await prisma.policy.count()).toBe(0);
    });

    it('rejects an expiry date on or before the start date', async () => {
      const res = await request(app.getHttpServer())
        .post('/v1/policies')
        .set(as('ravi'))
        .send({ ...validPolicy(), startDate: inDays(5), expiryDate: inDays(5) })
        .expect(400);
      expect(res.body).toMatchObject({ code: 'INVALID_DATES' });
    });

    it('saves nothing if one of the shares is invalid', async () => {
      const res = await request(app.getHttpServer())
        .post('/v1/policies')
        .set(as('ravi'))
        .send({ ...validPolicy(), shares: [{ mobile: '9123456789' }] })
        .expect(404);
      expect(res.body).toMatchObject({ code: 'NO_ACCOUNT_FOR_MOBILE' });
      expect(await prisma.policy.count()).toBe(0);
    });

    it('requires a bearer token', () =>
      request(app.getHttpServer())
        .post('/v1/policies')
        .send(validPolicy())
        .expect(401));
  });

  describe('reading and access', () => {
    it('lists owned and shared policies with filters', async () => {
      await createPolicy('ravi');
      await createPolicy('ravi', {
        category: 'MOTOR',
        startDate: inDays(-400),
        expiryDate: inDays(-10),
      });
      await createPolicy('kavya', {
        category: 'LIFE',
        shares: [{ mobile: '98765 43210' }],
      });

      const list = async (query: string) => {
        const res = await request(app.getHttpServer())
          .get(`/v1/policies${query}`)
          .set(as('ravi'))
          .expect(200);
        return (res.body as { category: string; access: string }[]).map(
          (p) => `${p.category}:${p.access}`,
        );
      };

      expect(await list('')).toEqual([
        'LIFE:VIEWER',
        'MOTOR:OWNER',
        'HEALTH:OWNER',
      ]);
      expect(await list('?scope=owned')).toEqual([
        'MOTOR:OWNER',
        'HEALTH:OWNER',
      ]);
      expect(await list('?scope=shared')).toEqual(['LIFE:VIEWER']);
      expect(await list('?category=MOTOR')).toEqual(['MOTOR:OWNER']);
      expect(await list('?state=expired')).toEqual(['MOTOR:OWNER']);
      expect(await list('?state=active')).toEqual([
        'LIFE:VIEWER',
        'HEALTH:OWNER',
      ]);
    });

    it('lets a viewer read but not change, and hides it from everyone else', async () => {
      const { id } = await createPolicy('ravi', {
        shares: [{ email: 'kavya@example.com' }],
      });

      const viewed = await request(app.getHttpServer())
        .get(`/v1/policies/${id}`)
        .set(as('kavya'))
        .expect(200);
      expect(viewed.body).toMatchObject({ access: 'VIEWER' });
      expect(viewed.body).not.toHaveProperty('shares');

      const patch = await request(app.getHttpServer())
        .patch(`/v1/policies/${id}`)
        .set(as('kavya'))
        .send({ provider: 'Hacked' })
        .expect(403);
      expect(patch.body).toMatchObject({ code: 'NOT_POLICY_OWNER' });
      await request(app.getHttpServer())
        .delete(`/v1/policies/${id}`)
        .set(as('kavya'))
        .expect(403);
      await request(app.getHttpServer())
        .post(`/v1/policies/${id}/shares`)
        .set(as('kavya'))
        .send({ email: 'stranger@example.com' })
        .expect(403);

      const server = () => request(app.getHttpServer());
      for (const send of [
        () => server().get(`/v1/policies/${id}`),
        () => server().patch(`/v1/policies/${id}`).send({ notes: 'x' }),
        () => server().delete(`/v1/policies/${id}`),
        () => server().get(`/v1/policies/${id}/shares`),
      ]) {
        const res = await send().set(as('stranger')).expect(404);
        expect(res.body).toMatchObject({ code: 'POLICY_NOT_FOUND' });
      }
    });

    it('returns renewals in the window, soonest first', async () => {
      await createPolicy('ravi', { provider: 'In 15' });
      await createPolicy('ravi', { provider: 'Today', expiryDate: inDays(0) });
      await createPolicy('ravi', { provider: 'In 45', expiryDate: inDays(45) });
      await createPolicy('ravi', {
        provider: 'Expired',
        startDate: inDays(-400),
        expiryDate: inDays(-1),
      });

      const providers = async (query = '') => {
        const res = await request(app.getHttpServer())
          .get(`/v1/policies/renewals${query}`)
          .set(as('ravi'))
          .expect(200);
        return (res.body as { provider: string }[]).map((p) => p.provider);
      };
      expect(await providers()).toEqual(['Today', 'In 15']);
      expect(await providers('?withinDays=60')).toEqual([
        'Today',
        'In 15',
        'In 45',
      ]);
      await request(app.getHttpServer())
        .get('/v1/policies/renewals?withinDays=0')
        .set(as('ravi'))
        .expect(400);
    });
  });

  describe('update and delete', () => {
    it('updates fields and replaces members', async () => {
      const { id } = await createPolicy('ravi');
      const res = await request(app.getHttpServer())
        .patch(`/v1/policies/${id}`)
        .set(as('ravi'))
        .send({
          sumInsured: 1000000,
          notes: '',
          members: [{ fullName: 'Aarav Kumar', relationship: 'CHILD' }],
        })
        .expect(200);
      expect(res.body).toMatchObject({
        sumInsured: 1000000,
        notes: null,
        provider: 'Star Health',
        members: [{ fullName: 'Aarav Kumar', relationship: 'CHILD' }],
      });
      expect(await prisma.policyMember.count()).toBe(1);
    });

    it('does not allow blanking mandatory fields or breaking the date order', async () => {
      const { id } = await createPolicy('ravi');
      await request(app.getHttpServer())
        .patch(`/v1/policies/${id}`)
        .set(as('ravi'))
        .send({ provider: null })
        .expect(400);
      await request(app.getHttpServer())
        .patch(`/v1/policies/${id}`)
        .set(as('ravi'))
        .send({ members: [] })
        .expect(400);
      const res = await request(app.getHttpServer())
        .patch(`/v1/policies/${id}`)
        .set(as('ravi'))
        .send({ expiryDate: inDays(-400) })
        .expect(400);
      expect(res.body).toMatchObject({ code: 'INVALID_DATES' });
    });

    it('deletes the policy for everyone', async () => {
      const { id } = await createPolicy('ravi', {
        shares: [{ email: 'kavya@example.com' }],
      });
      await request(app.getHttpServer())
        .delete(`/v1/policies/${id}`)
        .set(as('ravi'))
        .expect(200);
      expect(await prisma.policyShare.count()).toBe(0);
      await request(app.getHttpServer())
        .get(`/v1/policies/${id}`)
        .set(as('kavya'))
        .expect(404);
    });
  });

  describe('sharing', () => {
    it('shares by email or mobile and rejects duplicates and self', async () => {
      const { id } = await createPolicy('ravi');
      const share = (body: object) =>
        request(app.getHttpServer())
          .post(`/v1/policies/${id}/shares`)
          .set(as('ravi'))
          .send(body);

      const added = await share({ mobile: '+919876543211' }).expect(201);
      expect(added.body).toMatchObject({
        email: 'kavya@example.com',
        status: 'ACTIVE',
      });

      await share({ email: 'KAVYA@example.com' })
        .expect(409)
        .expect(({ body }) =>
          expect(body).toMatchObject({ code: 'ALREADY_SHARED' }),
        );
      await share({ email: 'ravi@example.com' })
        .expect(400)
        .expect(({ body }) =>
          expect(body).toMatchObject({ code: 'CANNOT_SHARE_WITH_SELF' }),
        );
      await share({ email: 'a@example.com', mobile: '+919876543212' })
        .expect(400)
        .expect(({ body }) =>
          expect(body).toMatchObject({ code: 'INVALID_SHARE_TARGET' }),
        );
      await share({}).expect(400);
    });

    it('keeps an email invite pending until that person signs up', async () => {
      const { id } = await createPolicy('ravi', {
        shares: [{ email: 'newbie@example.com' }],
      });
      const shares = await request(app.getHttpServer())
        .get(`/v1/policies/${id}/shares`)
        .set(as('ravi'))
        .expect(200);
      expect(shares.body).toMatchObject([
        { email: 'newbie@example.com', fullName: null, status: 'PENDING' },
      ]);

      await seedUser('newbie', '+919876543299');
      const list = await request(app.getHttpServer())
        .get('/v1/policies')
        .set(as('newbie'))
        .expect(200);
      expect(list.body).toMatchObject([{ id, access: 'VIEWER' }]);

      const after = await request(app.getHttpServer())
        .get(`/v1/policies/${id}/shares`)
        .set(as('ravi'))
        .expect(200);
      expect(after.body).toMatchObject([
        {
          email: 'newbie@example.com',
          fullName: 'newbie Kumar',
          status: 'ACTIVE',
        },
      ]);
    });

    it('drops a pending invite if the person was already shared with another way', async () => {
      const { id } = await createPolicy('ravi', {
        shares: [{ email: 'newbie@example.com' }],
      });
      await seedUser('newbie', '+919876543299');
      await request(app.getHttpServer())
        .post(`/v1/policies/${id}/shares`)
        .set(as('ravi'))
        .send({ mobile: '+919876543299' })
        .expect(409);
    });

    it('lets the owner revoke and the viewer leave', async () => {
      const { id } = await createPolicy('ravi', {
        shares: [
          { email: 'kavya@example.com' },
          { email: 'stranger@example.com' },
        ],
      });
      const shares = await request(app.getHttpServer())
        .get(`/v1/policies/${id}/shares`)
        .set(as('ravi'))
        .expect(200);
      const kavyaShare = (shares.body as { id: string; email: string }[]).find(
        (s) => s.email === 'kavya@example.com',
      )!;

      await request(app.getHttpServer())
        .delete(`/v1/policies/${id}/shares/${kavyaShare.id}`)
        .set(as('ravi'))
        .expect(200);
      await request(app.getHttpServer())
        .get(`/v1/policies/${id}`)
        .set(as('kavya'))
        .expect(404);

      await request(app.getHttpServer())
        .delete(`/v1/policies/${id}/shares/me`)
        .set(as('stranger'))
        .expect(200);
      await request(app.getHttpServer())
        .get(`/v1/policies/${id}`)
        .set(as('stranger'))
        .expect(404);
      expect(await prisma.policyShare.count()).toBe(0);
    });
  });

  it('GET /dashboard summarises active policies', async () => {
    await createPolicy('ravi', { shares: [{ email: 'kavya@example.com' }] });
    await createPolicy('ravi', {
      category: 'MOTOR',
      sumInsured: 300000.25,
      expiryDate: inDays(60),
    });
    await createPolicy('ravi', {
      category: 'TRAVEL',
      startDate: inDays(-30),
      expiryDate: inDays(-1),
    });
    await createPolicy('kavya', {
      category: 'LIFE',
      sumInsured: 10000000,
      expiryDate: inDays(200),
      shares: [{ email: 'ravi@example.com' }],
    });

    const res = await request(app.getHttpServer())
      .get('/v1/dashboard')
      .set(as('ravi'))
      .expect(200);
    expect(res.body).toEqual({
      activeCount: 3,
      renewalsDueCount: 1,
      sharedByMeCount: 1,
      sharedWithMeCount: 1,
      totalCover: 10800000.25,
      byCategory: {
        HEALTH: 1,
        LIFE: 1,
        MOTOR: 1,
        HOME: 0,
        TRAVEL: 0,
        TERM: 0,
        OTHER: 0,
      },
    });
  });
});
