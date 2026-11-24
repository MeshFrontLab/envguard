import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync, execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const BIN = join(dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'envguard.js');
const run = (args, cwd, env = {}) =>
  spawnSync(process.execPath, [BIN, ...args], { cwd, encoding: 'utf8', env: { ...process.env, NO_COLOR: '1', ...env } });
const hasGit = spawnSync('git', ['--version']).status === 0;

function project(files) {
  const dir = mkdtempSync(join(tmpdir(), 'envguard-cli-'));
  for (const [name, text] of Object.entries(files)) writeFileSync(join(dir, name), text);
  return { dir, done: () => rmSync(dir, { recursive: true, force: true }) };
}

const EXAMPLE = '# @type port\nPORT=3000\n# @type url\nDATABASE_URL=\n# @optional\nSENTRY_DSN=\n# @enum development|production\nNODE_ENV=development\n';

test('all good exits 0', () => {
  const p = project({ '.env.example': EXAMPLE, '.env': 'PORT=3000\nDATABASE_URL=postgres://localhost/app\nNODE_ENV=production\n' });
  const r = run(['--no-git-check'], p.dir);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /all good \(4 variables checked\)/);
  p.done();
});

test('problems exit 1 and never print values', () => {
  const p = project({ '.env.example': EXAMPLE, '.env': 'PORT=80800\nNODE_ENV=staging-secret-value\nDEBUG=1\nDEBUG=2\n' });
  const r = run(['--no-git-check'], p.dir);
  assert.equal(r.status, 1);
  assert.match(r.stdout, /error +PORT +must be a port number/);
  assert.match(r.stdout, /DATABASE_URL +is missing \(required\)/);
  assert.match(r.stdout, /NODE_ENV +must be one of: development, production/);
  assert.match(r.stdout, /warning +DEBUG +is set twice \(lines 3 and 4\)/);
  assert.match(r.stdout, /DEBUG +is not in the example file/);
  assert.match(r.stdout, /3 errors, 2 warnings/);
  assert.ok(!r.stdout.includes('80800') && !r.stdout.includes('staging-secret-value'));
  p.done();
});

test('--strict fails on warnings, --json is machine readable', () => {
  const p = project({ '.env.example': 'A=\n', '.env': 'A=1\nB=2\n' });
  assert.equal(run(['--no-git-check'], p.dir).status, 0);
  assert.equal(run(['--no-git-check', '--strict'], p.dir).status, 1);
  const out = JSON.parse(run(['--no-git-check', '--json'], p.dir).stdout);
  assert.equal(out.warnings, 1);
  assert.equal(out.issues[0].key, 'B');
  p.done();
});

test('--process checks real environment variables', () => {
  const p = project({ '.env.example': EXAMPLE });
  const env = { PORT: '8080', DATABASE_URL: 'https://db.example.com', NODE_ENV: 'production' };
  assert.equal(run(['--process'], p.dir, env).status, 0);
  const r = run(['--process'], p.dir, { ...env, PORT: 'abc' });
  assert.equal(r.status, 1);
  assert.match(r.stdout, /checking environment variables/);
  p.done();
});

test('custom file names', () => {
  const p = project({ 'schema.env': 'X=\n', 'prod.env': 'X=1\n' });
  assert.equal(run(['-e', 'prod.env', '-x', 'schema.env', '--no-git-check'], p.dir).status, 0);
  p.done();
});

test('missing files and bad options exit 2 with a hint', () => {
  const p = project({ '.env': 'A=1\n' });
  let r = run([], p.dir);
  assert.equal(r.status, 2);
  assert.match(r.stderr, /envguard init/);
  writeFileSync(join(p.dir, '.env.example'), 'A=\n');
  rmSync(join(p.dir, '.env'));
  r = run([], p.dir);
  assert.equal(r.status, 2);
  assert.match(r.stderr, /--process/);
  assert.equal(run(['--wat'], p.dir).status, 2);
  assert.equal(run(['frobnicate'], p.dir).status, 2);
  p.done();
});

test('init writes a safe example and refuses to overwrite', () => {
  const p = project({ '.env': 'PORT=8080\nAPI_KEY=abc123secret\n' });
  let r = run(['init'], p.dir);
  assert.equal(r.status, 0, r.stderr);
  const example = readFileSync(join(p.dir, '.env.example'), 'utf8');
  assert.equal(example, '# @type port\nPORT=\nAPI_KEY=\n');
  assert.ok(!example.includes('abc123secret'));
  assert.equal(run(['init'], p.dir).status, 2);
  assert.equal(run(['init', '--force'], p.dir).status, 0);
  p.done();
});

test('warns when .env could be committed, errors when it is', { skip: !hasGit }, () => {
  const p = project({ '.env.example': 'A=\n', '.env': 'A=1\n' });
  const g = (...a) => execFileSync('git', a, { cwd: p.dir, stdio: 'ignore' });
  g('init', '-q');
  let r = run([], p.dir);
  assert.equal(r.status, 0);
  assert.match(r.stdout, /not in \.gitignore/);

  writeFileSync(join(p.dir, '.gitignore'), '.env\n');
  r = run([], p.dir);
  assert.match(r.stdout, /all good/);

  g('add', '-f', '.env');
  r = run([], p.dir);
  assert.equal(r.status, 1);
  assert.match(r.stdout, /committed to git/);
  p.done();
});
