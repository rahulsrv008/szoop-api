#!/usr/bin/env node
const { spawn } = require('child_process');

const MODE = {
  dev: 'development',
  development: 'development',
  uat: 'uat',
  stg: 'uat',
  staging: 'uat',
  prod: 'production',
  production: 'production',
};

const raw = process.argv[2];
let rest = process.argv.slice(3);
if (rest[0] === '--') rest = rest.slice(1);
const mode = MODE[raw];
if (!mode || !rest.length) {
  console.error('usage: node scripts/with-env.cjs <dev|uat|prod> -- <command>...');
  process.exit(1);
}

const env = {
  ...process.env,
  APP_ENV: mode,
  NODE_ENV: mode === 'development' ? 'development' : 'production',
};
console.log(`[env] APP_ENV=${mode}`);
const child = spawn(rest[0], rest.slice(1), { stdio: 'inherit', env, shell: true });
child.on('exit', (code) => process.exit(code ?? 1));
