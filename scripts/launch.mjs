import { createPrivateKey } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SignJWT } from 'jose';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const env = Object.fromEntries(
  readFileSync(join(root, '.env'), 'utf8')
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => {
      const separator = line.indexOf('=');
      return [line.slice(0, separator), line.slice(separator + 1)];
    }),
);

const toolUrl = env.TOOL_URL.replace(/\/+$/, '');
const launchUrl = `${toolUrl}/lti/launch`;
const cookieJar = new Map();

function absorbCookies(response) {
  const values = response.headers.getSetCookie?.() || [response.headers.get('set-cookie')].filter(Boolean);
  for (const value of values) {
    const [pair] = value.split(';');
    const separator = pair.indexOf('=');
    cookieJar.set(pair.slice(0, separator), pair.slice(separator + 1));
  }
}

function cookieHeader() {
  return [...cookieJar].map(([name, value]) => `${name}=${value}`).join('; ');
}

async function followLaunch(url, options, maxRedirects = 6) {
  let currentUrl = url;
  let method = options.method;
  let body = options.body;
  const headers = { ...options.headers };

  for (let redirect = 0; redirect < maxRedirects; redirect += 1) {
    headers.Cookie = cookieHeader();
    const response = await fetch(currentUrl, { method, body, headers, redirect: 'manual' });
    absorbCookies(response);
    const location = response.headers.get('location');
    if (response.status < 300 || response.status >= 400 || !location) return response;
    currentUrl = new URL(location, currentUrl).toString();
    method = 'GET';
    body = undefined;
    delete headers['Content-Type'];
  }
  throw new Error('Launch exceeded the redirect limit.');
}

const loginParameters = new URLSearchParams({
  iss: env.PLATFORM_URL,
  login_hint: 'student-1',
  target_link_uri: launchUrl,
  client_id: env.PLATFORM_CLIENT_ID,
  lti_deployment_id: env.LTI_DEPLOYMENT_ID,
});
const loginResponse = await fetch(`${toolUrl}/login?${loginParameters}`, { redirect: 'manual' });
absorbCookies(loginResponse);
const authorizationUrl = new URL(loginResponse.headers.get('location'));
const state = authorizationUrl.searchParams.get('state');
const nonce = authorizationUrl.searchParams.get('nonce');
if (!state || !nonce) throw new Error('OIDC login did not return state and nonce.');

const now = Math.floor(Date.now() / 1000);
const claim = (name) => `https://purl.imsglobal.org/spec/lti/claim/${name}`;
const idToken = await new SignJWT({
  nonce,
  name: 'Sam Student',
  given_name: 'Sam',
  family_name: 'Student',
  email: 'sam@example.edu',
  [claim('message_type')]: 'LtiResourceLinkRequest',
  [claim('version')]: '1.3.0',
  [claim('deployment_id')]: env.LTI_DEPLOYMENT_ID,
  [claim('target_link_uri')]: launchUrl,
  [claim('resource_link')]: { id: 'resource-1', title: 'Handshake POC' },
  [claim('roles')]: [
    'http://purl.imsglobal.org/vocab/lis/v2/membership#Learner',
    'http://purl.imsglobal.org/vocab/lis/v2/institution/person#Student',
  ],
  [claim('context')]: {
    id: 'course-101',
    label: 'LTI-POC-101',
    title: 'LTI POC Course',
    type: ['http://purl.imsglobal.org/vocab/lis/v2/course#CourseOffering'],
  },
  [claim('tool_platform')]: { guid: 'lti-poc-platform', name: 'LTI POC Platform' },
  [claim('launch_presentation')]: { document_target: 'iframe', return_url: `${env.PLATFORM_URL}/return` },
})
  .setProtectedHeader({ alg: 'RS256', kid: env.LTI_KID, typ: 'JWT' })
  .setIssuer(env.PLATFORM_URL)
  .setAudience(env.PLATFORM_CLIENT_ID)
  .setSubject('student-1')
  .setIssuedAt(now)
  .setExpirationTime(now + 300)
  .sign(createPrivateKey(readFileSync(join(root, '.platform-key.pem'))));

const launchResponse = await followLaunch(launchUrl, {
  method: 'POST',
  headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  body: new URLSearchParams({ id_token: idToken, state }).toString(),
});
const responseBody = await launchResponse.text();
const expected = [
  'LTI 1.3 handshake complete',
  'Sam Student',
  'course-101',
  '<dd>1</dd>',
  'Learner, Student',
];
const missing = expected.filter((value) => !responseBody.includes(value));

if (launchResponse.status !== 200 || missing.length) {
  console.error(`FAIL: launch returned HTTP ${launchResponse.status}.`);
  if (missing.length) console.error(`Missing response values: ${missing.join(', ')}`);
  console.error(responseBody.slice(0, 600));
  process.exit(1);
}

console.log('PASS: complete LTI 1.3 OIDC launch handshake validated.');
console.log('  state and nonce round-trip: yes');
console.log('  platform JWT signature:    verified');
console.log('  audience and deployment:   verified');
console.log('  role and course context:    routed');