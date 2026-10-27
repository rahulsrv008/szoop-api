/**
 * Nest source files import `src/foo`. Local `nest build` + tsc-alias rewrites
 * those to relative requires. Vercel compiles `src/*.ts` itself and leaves
 * `require('src/foo')`, which Node looks up in node_modules.
 *
 * Loaded as the first import of main.ts so it runs no matter whether the
 * function entry is api/index.js, dist/main.js or src/main.js.
 */
import fs from 'fs';
import path from 'path';
import Module from 'module';

type ResolveFilename = (
  request: string,
  parent: NodeModule | undefined,
  isMain: boolean,
  options?: unknown,
) => string;

const loader = Module as unknown as { _resolveFilename: ResolveFilename };

const roots = [path.resolve(__dirname, '..'), process.cwd(), '/var/task'];

function existingFile(file: string) {
  try {
    return fs.existsSync(file) && fs.statSync(file).isFile();
  } catch {
    return false;
  }
}

const origResolve = loader._resolveFilename.bind(loader);

loader._resolveFilename = function resolveSrcAlias(request, parent, isMain, options) {
  if (typeof request === 'string' && request.startsWith('src/')) {
    const rest = request.slice('src/'.length);
    for (const root of roots) {
      for (const candidate of [
        path.join(root, 'dist', rest),
        path.join(root, 'src', rest),
        path.join(root, request),
      ]) {
        for (const file of [candidate, `${candidate}.js`, path.join(candidate, 'index.js')]) {
          if (existingFile(file)) {
            return origResolve(file, parent, isMain, options);
          }
        }
      }
    }
  }
  return origResolve(request, parent, isMain, options);
};
