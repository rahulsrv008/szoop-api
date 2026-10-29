#!/usr/bin/env node
/**
 * cPanel / CloudLinux entry. Node 20+ undici needs this flag because
 * WebAssembly otherwise reserves ~10GB of virtual memory and LVE kills the process.
 */
const { spawn } = require('child_process');
const path = require('path');

const root = path.join(__dirname, '..');
process.chdir(root);
process.env.APP_ENV = process.env.APP_ENV || 'production';
process.env.NODE_ENV = process.env.NODE_ENV || 'production';

const child = spawn(
  process.execPath,
  ['--disable-wasm-trap-handler', path.join(root, 'dist', 'main.js')],
  { stdio: 'inherit', env: process.env, cwd: root },
);
child.on('exit', (code) => process.exit(code ?? 1));
