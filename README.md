# PolicyValet API

NestJS + TypeScript backend for PolicyValetApp.

- **Auth:** Amazon Cognito (passwords, tokens, email codes)
- **Data:** PostgreSQL via Prisma (user profiles, later policies)
- **Hosting:** AWS ECS on one t3.micro (free-tier friendly), defined with AWS CDK in [`infra/`](infra/)

Swagger docs: `http://localhost:3000/docs`

## API (prefix `/v1`)

| Method | Path | Auth | Purpose |
|---|---|---|---|
| POST | `/v1/auth/register` | – | fullName, email, mobile, password, confirmPassword. Emails a 6-digit code. |
| POST | `/v1/auth/confirm-signup` | – | email + code |
| POST | `/v1/auth/resend-code` | – | email |
| POST | `/v1/auth/login` | – | `identifier` (email **or** mobile) + password → tokens + profile |
| POST | `/v1/auth/refresh` | – | refreshToken → new tokens |
| POST | `/v1/auth/logout` | Bearer | signs out on all devices |
| POST | `/v1/auth/forgot-password` | – | email → 6-digit reset code (always 200) |
| POST | `/v1/auth/reset-password` | – | email, code, newPassword, confirmPassword |
| GET | `/v1/users/me` | Bearer | profile |
| PATCH | `/v1/users/me` | Bearer | fullName / mobile / email (email needs verify-email) |
| POST | `/v1/users/me/verify-email` | Bearer | code sent to the new email |
| PATCH | `/v1/users/me/password` | Bearer | currentPassword, newPassword, confirmPassword |
| GET | `/health` | – | health check |

Send `Authorization: Bearer <accessToken>` on protected routes. Errors include a `code` the app can switch on:

| Code | Status | Meaning |
|---|---|---|
| `EMAIL_EXISTS`, `MOBILE_EXISTS` | 409 | Email or mobile already registered |
| `INVALID_CREDENTIALS` | 401 | Wrong identifier or password |
| `USER_NOT_CONFIRMED` | 403 | Email not verified; show the code screen |
| `INVALID_CODE`, `EXPIRED_CODE` | 400 | Bad or expired verification/reset code |
| `TOO_MANY_REQUESTS` | 429 | Rate limited |

Passwords must be at least 8 characters with an uppercase letter, a lowercase letter and a number.

## Local development

Needs Node 22 and PostgreSQL. Use Homebrew Postgres, or `docker compose up -d db`.

```bash
npm install
cp .env.example .env              # set DATABASE_URL + Cognito IDs (see "Deploy" step 2)
npx prisma migrate dev            # create tables
npm run start:dev
```

Tests: Cognito is mocked in the e2e tests, which need a `policyvalet_test` database.

```bash
npm test                          # unit
TEST_DATABASE_URL=postgresql://USER@localhost:5432/policyvalet_test npm run test:e2e
```

## Deploy to AWS

Prerequisites:
- AWS CLI signed in (`aws login`, then check with `aws sts get-caller-identity`)
- Docker
- A domain for HTTPS, e.g. `api.policyvalet.com`

All CDK commands run from `infra/`:

```bash
cd infra && npm install
export AWS_REGION=ap-south-1 CDK_DEFAULT_REGION=ap-south-1
```

1. **Bootstrap CDK** (once per account and region):
   ```bash
   npx cdk bootstrap
   ```

2. **Base stack:** Cognito user pool, app client, ECR repository. Optionally add an SES sender.
   ```bash
   npx cdk deploy PolicyValetBaseStack -c sesFromEmail=no-reply@yourdomain.com
   ```
   - Put the `UserPoolId` and `UserPoolClientId` outputs into your local `.env`. Local development now uses real Cognito, which is free.
   - Click the SES verification link that AWS emails to the sender address.
   - Request **SES production access** in the console. Until it's approved, SES only sends to verified addresses.
   - Once the sender is verified, switch Cognito to SES. Cognito's own sender only allows about 50 emails a day.
     ```bash
     npx cdk deploy PolicyValetBaseStack -c sesFromEmail=no-reply@yourdomain.com -c cognitoUseSes=true
     ```

3. **Push the first image:**
   ```bash
   ./deploy.sh
   ```

4. **App stack:** VPC, RDS Postgres, ECS on t3.micro, Caddy TLS proxy, Elastic IP, budget alert.
   ```bash
   npx cdk deploy PolicyValetAppStack -c apiDomain=api.yourdomain.com -c alertEmail=you@example.com
   ```
   Point a DNS **A record** for `api.yourdomain.com` at the `PublicIpAddress` output. Caddy then gets a Let's Encrypt certificate automatically. Without `apiDomain` the API is served over plain HTTP; use that only for testing.

5. **Later deploys:**
   ```bash
   ./deploy.sh
   ```
   This builds, pushes, rolls the service and waits until it's stable. Migrations run automatically when the container starts.

Pass the same `-c` values every time you run `cdk deploy`, or set them in `infra/cdk.json`.

### Cost notes
| Resource | Size | Cost |
|---|---|---|
| EC2 | t3.micro | free tier |
| RDS | db.t4g.micro, 20 GB gp2 | free tier |
| ECR | ≤3 images | free tier |
| Cognito | Lite | free ≤10k monthly active users |
| CloudWatch Logs | 7-day retention | free tier |

Small items that aren't free:
- the DB password in Secrets Manager: about $0.40 a month
- the public IPv4 address: about $3.60 a month, covered by the free tier/credits during the first months

There is deliberately **no load balancer and no NAT gateway**, because together they would cost about $50 a month. The trade-off is that a deploy restarts the single task, with roughly 30–60 seconds of downtime.

Shell access to the instance: use **SSM Session Manager**; no SSH keys are needed.
