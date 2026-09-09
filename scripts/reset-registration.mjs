// Reset the LMS simulator's registration so Dynamic Registration can be re-run.
// The LMS just forgets the current registration (in-memory) — nothing in Mongo
// needs changing, because each new registration mints a fresh client_id.
//
// URL comes from the azd environment (AZURE_LMS_URL) or the LMS_URL env var.

import { execSync } from 'node:child_process';

function azdValue(name) {
  try { return execSync(`azd env get-value ${name}`, { encoding: 'utf8' }).trim(); }
  catch { return ''; }
}

const lmsUrl = (process.env.LMS_URL || azdValue('AZURE_LMS_URL')).replace(/\/+$/, '');
if (!lmsUrl) {
  console.error('Missing LMS URL. Set LMS_URL, or run `azd env` first.');
  process.exit(2);
}

const response = await fetch(`${lmsUrl}/reset`, { method: 'POST' });
if (response.ok) {
  console.log('LMS registration cleared — open the LMS and register the tool again.');
  process.exit(0);
}
console.error(`Reset failed: HTTP ${response.status}`);
process.exit(1);
