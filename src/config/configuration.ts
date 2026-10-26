import * as Joi from 'joi';

export const envValidationSchema = Joi.object({
  NODE_ENV: Joi.string()
    .valid('development', 'production', 'test')
    .default('development'),
  PORT: Joi.number().default(3000),
  DATABASE_URL: Joi.string().uri().required(),
  AWS_REGION: Joi.string().required(),
  COGNITO_USER_POOL_ID: Joi.string().required(),
  COGNITO_CLIENT_ID: Joi.string().required(),
  DEFAULT_PHONE_REGION: Joi.string().length(2).default('IN'),
  CORS_ORIGINS: Joi.string().default('*'),
});

export default () => ({
  nodeEnv: process.env.NODE_ENV ?? 'development',
  port: Number(process.env.PORT ?? 3000),
  aws: {
    region: process.env.AWS_REGION as string,
  },
  cognito: {
    userPoolId: process.env.COGNITO_USER_POOL_ID as string,
    clientId: process.env.COGNITO_CLIENT_ID as string,
  },
  corsOrigins: (process.env.CORS_ORIGINS ?? '*')
    .split(',')
    .map((o) => o.trim()),
});
