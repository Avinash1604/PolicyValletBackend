import { Global, Module } from '@nestjs/common';
import { CognitoService } from './cognito.service';

@Global()
@Module({
  providers: [CognitoService],
  exports: [CognitoService],
})
export class CognitoModule {}
