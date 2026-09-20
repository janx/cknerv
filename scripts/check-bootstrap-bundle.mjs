import { readFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { execFileSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dist = resolve(root, 'ui-app/dist');
const rootPackage = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'));
const vitePackage = JSON.parse(readFileSync(resolve(root, 'ui-app/node_modules/vite/package.json'), 'utf8'));
const graph = JSON.parse(readFileSync(resolve(dist, '.vite/bootstrap-static-graph.json'), 'utf8'));
const manifest = JSON.parse(readFileSync(resolve(dist, '.vite/manifest.json'), 'utf8'));
const manifestEntry = Object.values(manifest).find((item) => item.isEntry && item.file === graph.entry);
if (!manifestEntry) throw new Error('Vite manifest does not name the Rollup bootstrap entry');
if (manifestEntry.file !== graph.entry) {
  throw new Error(`manifest entry ${manifestEntry.file} disagrees with Rollup graph ${graph.entry}`);
}

let rawBytes = 0;
let gzipBytes = 0;
const files = graph.files.map((file) => {
  const bytes = readFileSync(resolve(dist, file));
  const gzip = gzipSync(bytes).byteLength;
  rawBytes += bytes.byteLength;
  gzipBytes += gzip;
  return { file, rawBytes: bytes.byteLength, gzipBytes: gzip };
});
const bannedPatterns = [
  /\/node_modules\/three\//,
  /\/node_modules\/@react-three\/fiber\//,
  /\/node_modules\/@react-three\/drei\//,
  /\/node_modules\/leva\//,
  /\/node_modules\/react-dom\//,
];
const bannedModules = graph.modules.filter((moduleId) => (
  bannedPatterns.some((pattern) => pattern.test(moduleId.replaceAll('\\', '/')))
));
const command = (name, args, cwd = root) => execFileSync(name, args, {
  cwd,
  encoding: 'utf8',
  stdio: ['ignore', 'pipe', 'pipe'],
}).trim();
const result = {
  commit: command('git', ['rev-parse', 'HEAD']),
  node: process.version,
  pnpm: rootPackage.packageManager,
  vite: vitePackage.version,
  compression: 'node:zlib.gzipSync default level; each emitted static JS response compressed separately',
  budget: { gzipBytes: 25_000 },
  entry: graph.entry,
  files,
  rawBytes,
  gzipBytes,
  modules: graph.modules,
  bannedModules,
};
console.log(JSON.stringify(result, null, 2));
if (gzipBytes > result.budget.gzipBytes) {
  throw new Error(`bootstrap static JS is ${gzipBytes} gzip bytes; budget is ${result.budget.gzipBytes}`);
}
if (bannedModules.length > 0) {
  throw new Error(`bootstrap static graph contains heavyweight modules:\n${bannedModules.join('\n')}`);
}
