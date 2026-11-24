import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseDotenv, toObject, parseSchema, validate, checkType, makeExample, inferType, assertEnv } from '../src/index.js';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('parses common .env syntax', () => {
  const text = [
    '# comment',
    '',
    'PLAIN=hello world',
    'export EXPORTED=yes',
    'WITH_COMMENT=abc # trailing note',
    'HASH_IN_VALUE=abc#def',
    'DOUBLE="line1\\nline2 # not a comment"',
    "SINGLE='raw $HOME \\n'",
    'EMPTY=',
    'MULTI="first',
    'second"',
    'SPACES =  padded  ',
  ].join('\n');
  const obj = toObject(text);
  assert.deepEqual(obj, {
    PLAIN: 'hello world',
    EXPORTED: 'yes',
    WITH_COMMENT: 'abc',
    HASH_IN_VALUE: 'abc#def',
    DOUBLE: 'line1\nline2 # not a comment',
    SINGLE: 'raw $HOME \\n',
    EMPTY: '',
    MULTI: 'first\nsecond',
    SPACES: 'padded',
  });
  const { entries } = parseDotenv(text);
  assert.equal(entries.find((e) => e.key === 'MULTI').line, 10);
  assert.equal(entries.find((e) => e.key === 'MULTI').endLine, 11);
});

test('reports broken lines', () => {
  const { errors } = parseDotenv('GOOD=1\nnot a variable\n1BAD=x\nOPEN="never closed');
  assert.deepEqual(errors.map((e) => e.line), [2, 3, 4]);
  assert.match(errors[2].message, /missing closing "/);
});

test('handles Windows line endings and a BOM', () => {
  assert.deepEqual(toObject('﻿A=1\r\nB=2\r\n'), { A: '1', B: '2' });
});

test('reads annotations from comments', () => {
  const { vars, errors } = parseSchema(
    [
      '# Port the server listens on',
      '# @type port',
      'PORT=3000',
      '',
      '# @optional  @type url',
      'SENTRY_DSN=',
      'NODE_ENV=development # @enum development|production|test',
      '# Contact admin@example.com for a key',
      '# @pattern ^sk_(test|live)_',
      'STRIPE_KEY=',
      '# @default 10',
      '# @type int @min 1 @max 50',
      'POOL=',
    ].join('\n'),
  );
  assert.deepEqual(errors, []);
  assert.equal(vars.get('PORT').type, 'port');
  assert.equal(vars.get('PORT').description, 'Port the server listens on');
  assert.equal(vars.get('SENTRY_DSN').required, false);
  assert.equal(vars.get('SENTRY_DSN').type, 'url');
  assert.deepEqual(vars.get('NODE_ENV').enum, ['development', 'production', 'test']);
  assert.equal(vars.get('STRIPE_KEY').pattern.source, '^sk_(test|live)_');
  assert.equal(vars.get('STRIPE_KEY').description, 'Contact admin@example.com for a key');
  assert.equal(vars.get('POOL').required, false);
  assert.equal(vars.get('POOL').max, 50);
});

test('reports bad annotations', () => {
  const { errors } = parseSchema('# @type colour\nA=\n# @pattern (\nB=\n# @wat\nC=\n');
  assert.equal(errors.length, 3);
  assert.match(errors[0].message, /unknown @type "colour"/);
});

test('type checks', () => {
  const ok = { number: ['1', '-2.5', '1e3'], int: ['42', '-1'], boolean: ['true', 'NO', '0', 'on'], port: ['80', '65535'],
    url: ['https://example.com/x', 'postgres://u@h:5432/db'], email: ['a@b.co'], json: ['{"a":1}', '[1]'],
    uuid: ['123e4567-e89b-12d3-a456-426614174000'] };
  const bad = { number: ['abc', ''], int: ['1.5'], boolean: ['maybe'], port: ['0', '70000', 'http'],
    url: ['example.com', 'not a url'], email: ['nope'], json: ['{a:1}'], uuid: ['123'] };
  for (const [t, vals] of Object.entries(ok)) for (const v of vals) assert.equal(checkType(t, v), null, `${t} ${v}`);
  for (const [t, vals] of Object.entries(bad)) for (const v of vals) assert.notEqual(checkType(t, v), null, `${t} ${v}`);
});

test('validate finds missing, empty, invalid and undocumented variables', () => {
  const { vars } = parseSchema(
    '# @type port\nPORT=\nDATABASE_URL=\n# @optional\nOPTIONAL=\n# @enum a|b\nMODE=\n# @allow-empty\nBLANK_OK=\n# @type int @min 1\nWORKERS=\n',
  );
  const env = new Map([
    ['PORT', 'eighty'],
    ['MODE', 'c'],
    ['BLANK_OK', ''],
    ['WORKERS', '0'],
    ['EXTRA', 'x'],
  ]);
  const issues = validate(env, vars);
  const byKey = Object.fromEntries(issues.map((i) => [i.key, i]));
  assert.match(byKey.PORT.message, /port number/);
  assert.match(byKey.DATABASE_URL.message, /missing/);
  assert.match(byKey.MODE.message, /one of: a, b/);
  assert.match(byKey.WORKERS.message, /at least 1/);
  assert.equal(byKey.EXTRA.severity, 'warning');
  assert.ok(!byKey.OPTIONAL && !byKey.BLANK_OK);
  assert.equal(issues.length, 5);
});

test('messages never contain the value', () => {
  const secret = 'hunter2-very-secret'; // fake value for this test; secret-sweep:ignore
  const { vars } = parseSchema('# @type url\nA=\n# @pattern ^x\nB=\n# @enum p|q\nC=\n');
  const issues = validate(new Map([['A', secret], ['B', secret], ['C', secret]]), vars);
  assert.equal(issues.length, 3);
  assert.ok(!JSON.stringify(issues).includes(secret));
});

test('makeExample strips values, keeps comments and guesses types', () => {
  const out = makeExample(
    '# Server\nPORT=8080\nDEBUG=true\nAPI_URL=https://api.example.com\nSECRET="multi\nline"\nNAME=app # inline\n',
  );
  assert.equal(out, '# Server\n# @type port\nPORT=\n# @type boolean\nDEBUG=\n# @type url\nAPI_URL=\nSECRET=\nNAME=\n');
  assert.equal(inferType('COUNT', '3'), 'int');
  assert.equal(inferType('NAME', 'x'), null);
});

test('assertEnv throws one readable error listing every problem', () => {
  const dir = mkdtempSync(join(tmpdir(), 'envguard-'));
  writeFileSync(join(dir, '.env.example'), '# @type port\nPORT=\nTOKEN=\n');
  assert.throws(
    () => assertEnv({ cwd: dir, processEnv: { PORT: 'x' } }),
    (e) => /2 problems/.test(e.message) && /PORT must be a port/.test(e.message) && /TOKEN is missing/.test(e.message),
  );
  assert.equal(assertEnv({ cwd: dir, processEnv: { PORT: '3000', TOKEN: 'abc', OTHER: '1' } }), true);
  rmSync(dir, { recursive: true, force: true });
});
