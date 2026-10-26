#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';
import { AppStack } from '../lib/app-stack';
import { BaseStack } from '../lib/base-stack';

const app = new cdk.App();
const ctx = (key: string) => app.node.tryGetContext(key) as string | undefined;

const env = {
  account: process.env.CDK_DEFAULT_ACCOUNT,
  region: process.env.CDK_DEFAULT_REGION ?? 'ap-south-1',
};
const tags = { project: 'policyvalet' };

const base = new BaseStack(app, 'PolicyValetBaseStack', {
  env,
  tags,
  sesFromEmail: ctx('sesFromEmail') || undefined,
  cognitoUseSes: String(ctx('cognitoUseSes')) === 'true',
});

new AppStack(app, 'PolicyValetAppStack', {
  env,
  tags,
  userPool: base.userPool,
  userPoolClient: base.userPoolClient,
  repository: base.repository,
  apiDomain: ctx('apiDomain') || undefined,
  alertEmail: ctx('alertEmail') || undefined,
  corsOrigins: ctx('corsOrigins') || '*',
});
