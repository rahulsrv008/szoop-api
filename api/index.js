'use strict';

const fs = require('fs');
const path = require('path');
const Module = require('module');

const root = path.resolve(__dirname, '..');

try {
  require('tsconfig-paths').register({
    baseUrl: root,
    paths: { 'src/*': ['src/*', 'dist/*', 'dist/src/*'] },
  });
} catch {
  /* bundled function still has the Module hook below */
}

/**
 * Nest source imports `src/foo`. Vercel's Node compiler keeps that specifier
 * when it emits /var/task/src/*.js. Map it onto a real file.
 */
const origResolve = Module._resolveFilename;
Module._resolveFilename = function resolveSrcAlias(request, parent, isMain, options) {
  if (typeof request === 'string' && request.startsWith('src/')) {
    const rest = request.slice('src/'.length);
    for (const candidate of [
      path.join(root, 'dist', rest),
      path.join(root, 'src', rest),
      path.join(root, request),
    ]) {
      for (const file of [candidate, `${candidate}.js`, path.join(candidate, 'index.js')]) {
        if (fs.existsSync(file) && fs.statSync(file).isFile()) {
          return origResolve.call(this, file, parent, isMain, options);
        }
      }
    }
  }
  return origResolve.call(this, request, parent, isMain, options);
};

// Static so Vercel file tracing packs dist (a variable require() is invisible to it).
const { createServer } = require('../dist/main');

let serverPromise = null;

/** Vercel rewrite sends the real path as ?__path= so Nest still sees /health and /api/v1/... */
function restoreUrl(req) {
  const raw = req.url || '/';
  const qIndex = raw.indexOf('?');
  if (qIndex === -1) return;
  const params = new URLSearchParams(raw.slice(qIndex + 1));
  const nested = params.get('__path');
  if (!nested) return;
  params.delete('__path');
  const qs = params.toString();
  req.url = qs ? `${nested}?${qs}` : nested;
}

module.exports = async function handler(req, res) {
  try {
    restoreUrl(req);
    if (!serverPromise) serverPromise = createServer(false);
    const server = await serverPromise;
    return server(req, res);
  } catch (err) {
    serverPromise = null;
    const message = err instanceof Error ? err.stack || err.message : String(err);
    res.statusCode = 500;
    res.setHeader('content-type', 'text/plain; charset=utf-8');
    res.end(message);
  }
};
