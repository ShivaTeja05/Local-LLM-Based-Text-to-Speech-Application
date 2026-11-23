// Writes public/config.js from the ELLIE_API_BASE environment variable before a production build,
// so a separately hosted frontend (e.g. on Vercel) knows where the backend is.
//   ELLIE_API_BASE=https://ellie-xxxx.europe-west1.run.app node scripts/write-config.mjs
import { writeFileSync } from 'node:fs';

const base = (process.env.ELLIE_API_BASE ?? '').trim().replace(/\/$/, '');
if (base && !/^https:\/\/[a-z0-9.-]+(:\d+)?$/i.test(base)) {
  console.error(`ELLIE_API_BASE must be an https:// origin, got: ${base}`);
  process.exit(1);
}
writeFileSync('public/config.js', `window.ELLIE_API_BASE = ${JSON.stringify(base)};\n`);
console.log(`config.js: API at ${base || 'this same site'}`);
