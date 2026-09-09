import { createPublicKey, generateKeyPairSync, randomBytes, randomUUID } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { calculateJwkThumbprint, exportJWK } from 'jose';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const privateKeyPath = join(root, '.platform-key.pem');
const publicKeyPath = join(root, '.platform-key.pub.pem');
const envPath = join(root, '.env');

const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const privatePem = privateKey.export({ type: 'pkcs8', format: 'pem' });
const publicPem = publicKey.export({ type: 'spki', format: 'pem' });
const publicJwk = await exportJWK(createPublicKey(publicPem));
const kid = await calculateJwkThumbprint(publicJwk, 'sha256');

writeFileSync(privateKeyPath, privatePem, { mode: 0o600 });
writeFileSync(publicKeyPath, publicPem);
writeFileSync(envPath, [
  `LTI_KEY=${randomBytes(32).toString('hex')}`,
  'PLATFORM_URL=https://local-lti-platform.example',
  `PLATFORM_CLIENT_ID=${randomUUID()}`,
  'PLATFORM_AUTH_ENDPOINT=https://local-lti-platform.example/authorize',
  'PLATFORM_TOKEN_ENDPOINT=https://local-lti-platform.example/token',
  `PLATFORM_PUBLIC_KEY=${Buffer.from(publicPem).toString('base64')}`,
  `LTI_KID=${kid}`,
  'LTI_DEPLOYMENT_ID=1',
  'TOOL_URL=http://localhost:3000',
  '',
].join('\n'));

console.log('Generated .env and a synthetic platform keypair.');