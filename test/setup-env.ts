process.env.NODE_ENV = 'test';
process.env.DATABASE_URL =
  process.env.TEST_DATABASE_URL ??
  'postgresql://postgres:postgres@localhost:5432/policyvalet_test?schema=public';
process.env.AWS_REGION = 'ap-south-1';
process.env.COGNITO_USER_POOL_ID = 'ap-south-1_TestPool1';
process.env.COGNITO_CLIENT_ID = 'test-client-id';
process.env.DEFAULT_PHONE_REGION = 'IN';
