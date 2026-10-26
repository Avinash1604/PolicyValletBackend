import { execSync } from 'child_process';
import './setup-env';

export default function globalSetup() {
  execSync('npx prisma migrate deploy', { stdio: 'inherit', env: process.env });
}
