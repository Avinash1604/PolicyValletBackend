import * as cdk from 'aws-cdk-lib';
import * as budgets from 'aws-cdk-lib/aws-budgets';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as ecr from 'aws-cdk-lib/aws-ecr';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as rds from 'aws-cdk-lib/aws-rds';
import { Construct } from 'constructs';

export interface AppStackProps extends cdk.StackProps {
  userPool: cognito.IUserPool;
  userPoolClient: cognito.IUserPoolClient;
  repository: ecr.IRepository;
  /** e.g. api.policyvalet.com. Enables HTTPS via Caddy + Let's Encrypt; without it the API is plain HTTP. */
  apiDomain?: string;
  /** Receives the $5/month budget alerts. */
  alertEmail?: string;
  corsOrigins: string;
}

/**
 * Free-tier-friendly runtime: one t3.micro running ECS (no Fargate, no ALB, no NAT),
 * with Caddy terminating TLS in front of the API, and a db.t4g.micro Postgres.
 */
export class AppStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: AppStackProps) {
    super(scope, id, props);

    const vpc = new ec2.Vpc(this, 'Vpc', {
      maxAzs: 2,
      natGateways: 0,
      subnetConfiguration: [
        { name: 'public', subnetType: ec2.SubnetType.PUBLIC },
        { name: 'db', subnetType: ec2.SubnetType.PRIVATE_ISOLATED },
      ],
    });

    // ---- Database ----
    const db = new rds.DatabaseInstance(this, 'Postgres', {
      engine: rds.DatabaseInstanceEngine.postgres({
        version: rds.PostgresEngineVersion.VER_17,
      }),
      instanceType: ec2.InstanceType.of(
        ec2.InstanceClass.T4G,
        ec2.InstanceSize.MICRO,
      ),
      vpc,
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_ISOLATED },
      databaseName: 'policyvalet',
      credentials: rds.Credentials.fromGeneratedSecret('policyvalet', {
        excludeCharacters: ' %+~`#$&*()|[]{}:;<>?!\'/@"\\',
      }),
      allocatedStorage: 20,
      storageType: rds.StorageType.GP2,
      storageEncrypted: true,
      multiAz: false,
      publiclyAccessible: false,
      backupRetention: cdk.Duration.days(1),
      enablePerformanceInsights: false,
      deletionProtection: true,
      removalPolicy: cdk.RemovalPolicy.SNAPSHOT,
    });

    // ---- ECS on a single EC2 instance ----
    const cluster = new ecs.Cluster(this, 'Cluster', {
      vpc,
      clusterName: 'policyvalet',
    });
    const asg = cluster.addCapacity('Instance', {
      instanceType: ec2.InstanceType.of(
        ec2.InstanceClass.T3,
        ec2.InstanceSize.MICRO,
      ),
      machineImage: ecs.EcsOptimizedImage.amazonLinux2023(),
      minCapacity: 1,
      maxCapacity: 1,
      vpcSubnets: { subnetType: ec2.SubnetType.PUBLIC },
      associatePublicIpAddress: true,
    });
    asg.connections.allowFromAnyIpv4(ec2.Port.tcp(80), 'HTTP');
    asg.connections.allowFromAnyIpv4(ec2.Port.tcp(443), 'HTTPS');
    db.connections.allowDefaultPortFrom(asg, 'API instance');
    // Shell access through Session Manager instead of SSH.
    asg.role.addManagedPolicy(
      iam.ManagedPolicy.fromAwsManagedPolicyName('AmazonSSMManagedInstanceCore'),
    );

    // Fixed public IP that survives instance replacement: the instance claims it on boot.
    const eip = new ec2.CfnEIP(this, 'PublicIp', {
      tags: [{ key: 'Name', value: 'policyvalet-api' }],
    });
    asg.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['ec2:AssociateAddress'],
        resources: ['*'],
      }),
    );
    asg.addUserData(
      'dnf install -y awscli-2 || true',
      'TOKEN=$(curl -sX PUT http://169.254.169.254/latest/api/token -H "X-aws-ec2-metadata-token-ttl-seconds: 60")',
      'IID=$(curl -s -H "X-aws-ec2-metadata-token: $TOKEN" http://169.254.169.254/latest/meta-data/instance-id)',
      `aws ec2 associate-address --region ${this.region} --allocation-id ${eip.attrAllocationId} --instance-id $IID --allow-reassociation`,
      'mkdir -p /var/lib/caddy',
    );

    // ---- Task: API + Caddy (TLS) ----
    const logGroup = new logs.LogGroup(this, 'Logs', {
      logGroupName: '/policyvalet/api',
      retention: logs.RetentionDays.ONE_WEEK,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });
    const logging = (prefix: string) =>
      ecs.LogDrivers.awsLogs({ logGroup, streamPrefix: prefix });

    const task = new ecs.Ec2TaskDefinition(this, 'Task', {
      family: 'policyvalet-api',
      networkMode: ecs.NetworkMode.BRIDGE,
    });
    task.addVolume({
      name: 'caddy-data',
      host: { sourcePath: '/var/lib/caddy' },
    });
    props.userPool.grant(
      task.taskRole,
      'cognito-idp:AdminUpdateUserAttributes',
      'cognito-idp:AdminDeleteUser',
    );

    const api = task.addContainer('api', {
      image: ecs.ContainerImage.fromEcrRepository(props.repository, 'latest'),
      memoryLimitMiB: 512,
      environment: {
        NODE_ENV: 'production',
        PORT: '3000',
        AWS_REGION: this.region,
        COGNITO_USER_POOL_ID: props.userPool.userPoolId,
        COGNITO_CLIENT_ID: props.userPoolClient.userPoolClientId,
        DB_HOST: db.dbInstanceEndpointAddress,
        DB_PORT: db.dbInstanceEndpointPort,
        DB_NAME: 'policyvalet',
        DEFAULT_PHONE_REGION: 'IN',
        CORS_ORIGINS: props.corsOrigins,
      },
      secrets: {
        DB_USERNAME: ecs.Secret.fromSecretsManager(db.secret!, 'username'),
        DB_PASSWORD: ecs.Secret.fromSecretsManager(db.secret!, 'password'),
      },
      healthCheck: {
        command: [
          'CMD-SHELL',
          'wget -qO- http://localhost:3000/health || exit 1',
        ],
        startPeriod: cdk.Duration.seconds(60),
      },
      logging: logging('api'),
    });

    const caddy = task.addContainer('caddy', {
      image: ecs.ContainerImage.fromRegistry(
        'public.ecr.aws/docker/library/caddy:2-alpine',
      ),
      memoryLimitMiB: 128,
      command: [
        'caddy',
        'reverse-proxy',
        '--from',
        props.apiDomain ?? ':80',
        '--to',
        'api:3000',
      ],
      portMappings: [
        { containerPort: 80, hostPort: 80 },
        { containerPort: 443, hostPort: 443 },
      ],
      logging: logging('caddy'),
    });
    caddy.addLink(api, 'api');
    caddy.addContainerDependencies({
      container: api,
      condition: ecs.ContainerDependencyCondition.HEALTHY,
    });
    // Persist certificates so restarts don't hit Let's Encrypt rate limits.
    caddy.addMountPoints({
      sourceVolume: 'caddy-data',
      containerPath: '/data',
      readOnly: false,
    });

    // Host ports 80/443 fit only one task, so deploys stop the old task first (brief downtime).
    const service = new ecs.Ec2Service(this, 'Service', {
      cluster,
      serviceName: 'policyvalet-api',
      taskDefinition: task,
      desiredCount: 1,
      minHealthyPercent: 0,
      maxHealthyPercent: 100,
      circuitBreaker: { rollback: true },
    });

    // ---- Cost guard ----
    if (props.alertEmail) {
      const subscribers = [
        { subscriptionType: 'EMAIL', address: props.alertEmail },
      ];
      new budgets.CfnBudget(this, 'Budget', {
        budget: {
          budgetName: 'policyvalet-monthly',
          budgetType: 'COST',
          timeUnit: 'MONTHLY',
          budgetLimit: { amount: 5, unit: 'USD' },
        },
        notificationsWithSubscribers: [
          {
            notification: {
              notificationType: 'ACTUAL',
              comparisonOperator: 'GREATER_THAN',
              threshold: 80,
            },
            subscribers,
          },
          {
            notification: {
              notificationType: 'FORECASTED',
              comparisonOperator: 'GREATER_THAN',
              threshold: 100,
            },
            subscribers,
          },
        ],
      });
    }

    new cdk.CfnOutput(this, 'PublicIpAddress', { value: eip.ref });
    new cdk.CfnOutput(this, 'ApiUrl', {
      value: props.apiDomain
        ? `https://${props.apiDomain}`
        : `http://${eip.ref}`,
    });
    new cdk.CfnOutput(this, 'ClusterName', { value: cluster.clusterName });
    new cdk.CfnOutput(this, 'ServiceName', { value: service.serviceName });
  }
}
