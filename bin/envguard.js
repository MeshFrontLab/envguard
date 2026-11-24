#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { check, makeExample, EnvGuardError } from '../src/index.js';

const pkg = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'package.json'), 'utf8'));

const HELP = `envguard ${pkg.version} - check your .env file against .env.example before your app breaks

Usage:
  envguard                 check .env against .env.example
  envguard init            create .env.example from .env (all values removed)

Options:
  -e, --env <file>         env file to check (default: .env)
  -x, --example <file>     example/schema file (default: .env.example)
  -p, --process            check the real environment variables instead of a file (for CI/containers)
      --strict             treat warnings as errors
      --no-git-check       don't warn when the env file could be committed to git
      --json               print results as JSON
      --force              (init) overwrite an existing example file
  -q, --quiet              print nothing when everything is fine
  -h, --help               show this help
  -v, --version            show version

Annotate .env.example with comments to describe each variable:
  # @type port             string, number, int, boolean, url, email, port, json, uuid
  # @optional              may be missing
  # @enum dev|prod         one of these values
  # @pattern ^sk_          must match a regular expression

envguard never prints the values of your variables.
Exit codes: 0 = OK, 1 = problems found, 2 = usage error or missing file.`;

const useColor = process.stdout.isTTY && !process.env.NO_COLOR;
const paint = (code) => (s) => (useColor ? `\x1b[${code}m${s}\x1b[0m` : s);
const red = paint(31);
const yellow = paint(33);
const green = paint(32);
const bold = paint(1);
const dim = paint(2);

function fail(msg) {
  console.error(`envguard: ${msg}`);
  process.exit(2);
}

let parsed;
try {
  parsed = parseArgs({
    allowPositionals: true,
    options: {
      env: { type: 'string', short: 'e', default: '.env' },
      example: { type: 'string', short: 'x', default: '.env.example' },
      process: { type: 'boolean', short: 'p' },
      strict: { type: 'boolean' },
      'no-git-check': { type: 'boolean' },
      json: { type: 'boolean' },
      force: { type: 'boolean' },
      quiet: { type: 'boolean', short: 'q' },
      help: { type: 'boolean', short: 'h' },
      version: { type: 'boolean', short: 'v' },
    },
  });
} catch (e) {
  fail(`${e.message}\nRun "envguard --help" for usage.`);
}
const { values: opt, positionals } = parsed;
const command = positionals[0] || 'check';

if (opt.help) { console.log(HELP); process.exit(0); }
if (opt.version) { console.log(pkg.version); process.exit(0); }

if (command === 'init') {
  if (!existsSync(opt.env)) fail(`${opt.env} not found, nothing to copy from`);
  if (existsSync(opt.example) && !opt.force) fail(`${opt.example} already exists (use --force to overwrite it)`);
  const example = makeExample(readFileSync(opt.env, 'utf8'));
  writeFileSync(opt.example, example);
  const count = example.split('\n').filter((l) => /^[A-Za-z_][\w.-]*=/.test(l)).length;
  console.log(`envguard: wrote ${opt.example} with ${count} variable${count === 1 ? '' : 's'} (values removed). Review it, then commit it.`);
  process.exit(0);
}
if (command !== 'check') fail(`unknown command "${command}". Run "envguard --help" for usage.`);

let result;
try {
  result = check({ env: opt.env, example: opt.example, useProcess: opt.process, gitCheck: !opt['no-git-check'] });
} catch (e) {
  if (e instanceof EnvGuardError) {
    const hint = /example file/.test(e.message)
      ? '\nCreate one from your .env with: envguard init'
      : /env file/.test(e.message)
        ? `\nCopy ${opt.example} to ${opt.env} and fill it in, or use --process to check real environment variables.`
        : '';
    fail(e.message + hint);
  }
  throw e;
}

const { issues, checked, envLabel, exampleLabel } = result;
const errors = issues.filter((i) => i.severity === 'error').length;
const warnings = issues.length - errors;

if (opt.json) {
  console.log(JSON.stringify({ env: envLabel, example: exampleLabel, checked, errors, warnings, issues }, null, 2));
} else {
  if (issues.length || !opt.quiet) console.log(`envguard: checking ${bold(envLabel)} against ${bold(exampleLabel)}`);
  const width = Math.max(0, ...issues.map((i) => (i.key || '').length));
  for (const i of issues) {
    const sev = i.severity === 'error' ? red('error  ') : yellow('warning');
    console.log(`  ${sev}  ${i.key ? bold(i.key.padEnd(width)) + '  ' : ''}${i.message}`);
  }
  if (issues.length) {
    console.log(`\nenvguard: ${errors} error${errors === 1 ? '' : 's'}, ${warnings} warning${warnings === 1 ? '' : 's'}`);
  } else if (!opt.quiet) {
    console.log(green(`envguard: all good (${checked} variable${checked === 1 ? '' : 's'} checked)`));
  }
  if (errors && !opt.quiet) console.log(dim('Values are never shown. Fix the variables above and run envguard again.'));
}

process.exit(errors || (opt.strict && warnings) ? 1 : 0);
