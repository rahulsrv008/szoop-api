'use strict';

require('tsconfig-paths').register({
  baseUrl: require('path').resolve(__dirname, '..'),
  paths: { 'src/*': ['dist/*'] },
});

const { createServer } = require('../dist/main');

let serverPromise = null;

/** Vercel rewrite sends the real path as ?__path= so Nest still sees /health and /api/v1/... */
function restoreUrl(req) {
  const raw = req.url || '/';
  const qIndex = raw.indexOf('?');
  if (qIndex === -1) return;
  const params = new URLSearchParams(raw.slice(qIndex + 1));
  const path = params.get('__path');
  if (!path) return;
  params.delete('__path');
  const qs = params.toString();
  req.url = qs ? `${path}?${qs}` : path;
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
