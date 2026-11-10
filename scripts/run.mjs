import {spawn, spawnSync} from 'node:child_process';
import {readdirSync} from 'node:fs';
import {homedir} from 'node:os';
import {join, dirname} from 'node:path';

const tasks = {
  dev: ['scripts/dev.mjs'],
  build: ['scripts/build.mjs'],
  offline: ['scripts/build.mjs', '--offline'],
  test: ['--experimental-strip-types', '--test', 'tests/*.test.mjs'],
  check: ['scripts/validate.mjs'],
};
const task = process.argv[2] || 'dev';
if (!tasks[task]) throw new Error(`Unknown task: ${task}`);
const supported = version => {
  const [major, minor] = version.replace(/^v/, '').trim().split('.').map(Number);
  return major > 22 || (major === 22 && minor >= 13);
};
let runtime = process.execPath;
if (!supported(process.versions.node)) {
  const root = join(homedir(), '.nvm/versions/node');
  let candidates = [];
  try { candidates = readdirSync(root).filter(supported).sort((a,b)=>b.localeCompare(a, undefined, {numeric:true})).map(v=>join(root,v,'bin/node')); } catch {}
  runtime = candidates.find(path => {
    const result = spawnSync(path, ['--version'], {encoding:'utf8'});
    return result.status === 0 && supported(result.stdout);
  });
  if (!runtime) {
    console.error('Currenc Connect requires Node.js 22.13 or later. Install Node 22 or 24 and try again.');
    process.exit(1);
  }
}
const child = spawn(runtime, tasks[task], {
  stdio: 'inherit',
  env: {...process.env, PATH: `${dirname(runtime)}:${process.env.PATH || ''}`},
});
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal));
child.on('error', error => { console.error(error.message); process.exitCode = 1; });
child.on('exit', (code, signal) => { process.exitCode = code ?? (signal ? 1 : 0); });
