import { readFileSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, basename, resolve } from 'node:path';
import { parseDotenv, toObject } from './parse.js';
import { parseSchema, TYPES } from './schema.js';
import { validate, checkType } from './validate.js';

export { parseDotenv, toObject, parseSchema, validate, checkType, TYPES };

export class EnvGuardError extends Error {}

function readText(file, what) {
  if (!existsSync(file)) throw new EnvGuardError(`${what} not found: ${file}`);
  return readFileSync(file, 'utf8');
}

/**
 * Check an env file (or the process environment) against an example file.
 * @param {{ env?: string, example?: string, useProcess?: boolean, processEnv?: object, gitCheck?: boolean, cwd?: string }} opts
 * @returns {{ issues: {key?:string, line?:number, severity:string, message:string}[], checked: number, envLabel: string, exampleLabel: string }}
 */
export function check({ env = '.env', example = '.env.example', useProcess = false, processEnv = process.env, gitCheck = true, cwd = process.cwd() } = {}) {
  const examplePath = resolve(cwd, example);
  const schema = parseSchema(readText(examplePath, 'example file'));
  const issues = schema.errors.map((e) => ({
    key: e.key,
    line: e.line,
    severity: 'error',
    message: `${example}:${e.line}: ${e.key ? e.key + ' ' : ''}${e.message}`,
  }));

  let values;
  if (useProcess) {
    values = new Map(Object.entries(processEnv).filter(([, v]) => v !== undefined));
  } else {
    const envPath = resolve(cwd, env);
    const parsed = parseDotenv(readText(envPath, 'env file'));
    for (const e of parsed.errors) issues.push({ line: e.line, severity: 'error', message: `${env}:${e.line}: ${e.message}` });
    values = new Map();
    const firstLine = new Map();
    for (const { key, value, line } of parsed.entries) {
      if (firstLine.has(key)) {
        issues.push({ key, line, severity: 'warning', message: `is set twice (lines ${firstLine.get(key)} and ${line}); the last one wins` });
      } else firstLine.set(key, line);
      values.set(key, value);
    }
    if (gitCheck) issues.push(...gitSafety(envPath));
  }

  issues.push(...validate(values, schema.vars, { reportExtra: !useProcess }));
  return {
    issues,
    checked: schema.vars.size,
    envLabel: useProcess ? 'environment variables' : env,
    exampleLabel: example,
  };
}

/** Warn when the env file would be (or already is) committed to git. */
export function gitSafety(envPath) {
  const dir = dirname(envPath);
  const name = basename(envPath);
  const git = (args) => spawnSync('git', args, { cwd: dir, stdio: 'ignore' });
  const inRepo = git(['rev-parse', '--is-inside-work-tree']);
  if (inRepo.error || inRepo.status !== 0) return [];
  if (git(['ls-files', '--error-unmatch', '--', name]).status === 0) {
    return [{ severity: 'error', message: `${name} is committed to git. Remove it (git rm --cached ${name}), add it to .gitignore and rotate any secrets in it` }];
  }
  if (git(['check-ignore', '-q', '--', name]).status !== 0) {
    return [{ severity: 'warning', message: `${name} is not in .gitignore, so it could be committed by accident` }];
  }
  return [];
}

/**
 * Validate process.env at app start-up. Throws one readable error listing every problem.
 * Values are never included in the message.
 */
export function assertEnv({ example = '.env.example', processEnv = process.env, cwd = process.cwd() } = {}) {
  const { issues } = check({ example, useProcess: true, processEnv, cwd, gitCheck: false });
  const errors = issues.filter((i) => i.severity === 'error');
  if (errors.length) {
    throw new EnvGuardError(
      `Invalid environment (${errors.length} problem${errors.length === 1 ? '' : 's'}):\n` +
        errors.map((e) => `  - ${e.key ? e.key + ' ' : ''}${e.message}`).join('\n'),
    );
  }
  return true;
}

/** Guess a type annotation from an existing value (used by `envguard init`). */
export function inferType(key, value) {
  if (value === '') return null;
  if (/port$/i.test(key) && checkType('port', value) === null) return 'port';
  if (/^(?:true|false)$/i.test(value)) return 'boolean';
  if (/^-?\d+$/.test(value)) return 'int';
  if (checkType('url', value) === null) return 'url';
  if (checkType('email', value) === null) return 'email';
  return null;
}

/**
 * Turn a real .env file into a safe example: every value is removed, comments are
 * kept, and a "# @type" line is added where the type is obvious.
 */
export function makeExample(text) {
  const { entries, lines } = parseDotenv(text);
  const byLine = new Map(entries.map((e) => [e.line, e]));
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    const e = byLine.get(i + 1);
    if (!e) {
      // Keep comments and blank lines; drop anything else (such as broken lines).
      const l = lines[i];
      if (!l.trim() || l.trim().startsWith('#')) out.push(l);
      continue;
    }
    i = e.endLine - 1; // skip the rest of a multi-line value
    const prev = out.length ? out[out.length - 1].trim() : '';
    const t = inferType(e.key, e.value);
    if (t && !/@type\b/.test(prev)) out.push(`# @type ${t}`);
    out.push(`${e.key}=`);
  }
  while (out.length && !out[out.length - 1].trim()) out.pop();
  return out.join('\n') + '\n';
}
