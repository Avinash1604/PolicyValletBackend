import * as cdk from 'aws-cdk-lib';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import * as ecr from 'aws-cdk-lib/aws-ecr';
import * as ses from 'aws-cdk-lib/aws-ses';
import { Construct } from 'constructs';

export interface BaseStackProps extends cdk.StackProps {
  /** Sender address for auth emails. Creating the stack sends AWS's verification email to it. */
  sesFromEmail?: string;
  /** Switch Cognito to send through SES. Only enable after the SES identity is verified. */
  cognitoUseSes: boolean;
}

/** Long-lived resources: the user pool and the image repository. */
export class BaseStack extends cdk.Stack {
  readonly userPool: cognito.UserPool;
  readonly userPoolClient: cognito.UserPoolClient;
  readonly repository: ecr.Repository;

  constructor(scope: Construct, id: string, props: BaseStackProps) {
    super(scope, id, props);

    if (props.sesFromEmail) {
      new ses.EmailIdentity(this, 'SenderIdentity', {
        identity: ses.Identity.email(props.sesFromEmail),
      });
    }

    const email =
      props.cognitoUseSes && props.sesFromEmail
        ? cognito.UserPoolEmail.withSES({
            fromEmail: props.sesFromEmail,
            fromName: 'PolicyValet',
            sesRegion: this.region,
          })
        : // Cognito's built-in sender: fine for dev, limited to ~50 emails/day.
          cognito.UserPoolEmail.withCognito();

    this.userPool = new cognito.UserPool(this, 'UserPool', {
      userPoolName: 'policyvalet-users',
      featurePlan: cognito.FeaturePlan.LITE,
      selfSignUpEnabled: true,
      signInAliases: { email: true },
      signInCaseSensitive: false,
      autoVerify: { email: true },
      // A changed email only takes effect once the new address is verified.
      keepOriginal: { email: true },
      standardAttributes: {
        fullname: { required: true, mutable: true },
        email: { required: true, mutable: true },
        phoneNumber: { required: true, mutable: true },
      },
      // Keep in sync with IsStrongPassword in src/common/decorators/validators.ts.
      passwordPolicy: {
        minLength: 8,
        requireLowercase: true,
        requireUppercase: true,
        requireDigits: true,
        requireSymbols: false,
      },
      accountRecovery: cognito.AccountRecovery.EMAIL_ONLY,
      userVerification: {
        emailStyle: cognito.VerificationEmailStyle.CODE,
        emailSubject: 'Your PolicyValet code',
        emailBody:
          'Your PolicyValet verification code is {####}. Do not share this code with anyone.',
      },
      email,
      deletionProtection: true,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    this.userPoolClient = this.userPool.addClient('ApiClient', {
      userPoolClientName: 'policyvalet-api',
      generateSecret: false,
      authFlows: { userPassword: true },
      preventUserExistenceErrors: true,
      enableTokenRevocation: true,
      accessTokenValidity: cdk.Duration.hours(1),
      idTokenValidity: cdk.Duration.hours(1),
      refreshTokenValidity: cdk.Duration.days(30),
    });

    this.repository = new ecr.Repository(this, 'ApiRepository', {
      repositoryName: 'policyvalet-api',
      imageScanOnPush: true,
      lifecycleRules: [
        { description: 'Keep the last 3 images', maxImageCount: 3 },
      ],
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    new cdk.CfnOutput(this, 'UserPoolId', { value: this.userPool.userPoolId });
    new cdk.CfnOutput(this, 'UserPoolClientId', {
      value: this.userPoolClient.userPoolClientId,
    });
    new cdk.CfnOutput(this, 'RepositoryUri', {
      value: this.repository.repositoryUri,
    });
  }
}
