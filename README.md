# envguard

**Check your `.env` file against `.env.example` before your app breaks.** Catches missing variables, wrong types and `.env` files that are about to be committed. Zero dependencies, and it never prints your values.

[![CI](https://github.com/MeshFrontLab/envguard/actions/workflows/ci.yml/badge.svg)](https://github.com/MeshFrontLab/envguard/actions/workflows/ci.yml)
![node](https://img.shields.io/badge/node-%3E%3D22-informational)
![dependencies](https://img.shields.io/badge/dependencies-0-success)
![license](https://img.shields.io/badge/license-MIT-blue)

- Your `.env.example` is the schema. Add simple comments like `# @type port` or `# @enum dev|prod` to say what each variable should look like.
- Clear, one-line errors, safe to show in CI logs: values are never printed.
- Warns when `.env` is not in `.gitignore`, and fails when it has already been committed.
- `envguard init` writes a clean `.env.example` from your `.env`, with every value removed.
- Works on files, or on real environment variables in CI and containers (`--process`).

## Install

Requires [Node.js](https://nodejs.org) 22 or newer.

```sh
# run once, without installing
npx github:MeshFrontLab/envguard

# or install the `envguard` command globally
npm install -g github:MeshFrontLab/envguard

# or add it to a project
npm install --save-dev github:MeshFrontLab/envguard
```

## Usage

Given this `.env.example`:

```sh
# Port the web server listens on
# @type port
PORT=3000

# @type url
DATABASE_URL=

# @enum development|production|test
NODE_ENV=development

# Error tracking (leave out locally)
# @optional @type url
SENTRY_DSN=

# @pattern ^sk_(test|live)_
STRIPE_SECRET_KEY=
```

and a `.env` with a few mistakes, run `envguard` in the project folder:

```console
$ envguard
envguard: checking .env against .env.example
  warning  .env is not in .gitignore, so it could be committed by accident
  error    PORT               must be a port number (1-65535)
  error    DATABASE_URL       is missing (required)
  error    NODE_ENV           must be one of: development, production, test
  error    STRIPE_SECRET_KEY  does not match the pattern ^sk_(test|live)_
  warning  DEBUG              is not in the example file (undocumented)

envguard: 4 errors, 2 warnings
Values are never shown. Fix the variables above and run envguard again.
```

Once it is fixed:

```console
$ envguard
envguard: checking .env against .env.example
envguard: all good (5 variables checked)
```

### Create `.env.example` from an existing `.env`

```console
$ envguard init
envguard: wrote .env.example with 4 variables (values removed). Review it, then commit it.

$ cat .env.example
# @type port
PORT=
# @type boolean
DEBUG=
# @type url
API_URL=
API_KEY=
```

### Check real environment variables (CI, Docker, servers)

```sh
envguard --process
```

GitHub Actions example:

```yaml
- uses: actions/setup-node@v5
  with:
    node-version: 22
- run: npx --yes github:MeshFrontLab/envguard --process
  env:
    DATABASE_URL: ${{ secrets.DATABASE_URL }}
    PORT: 8080
```

### Check at app start-up

```js
import { assertEnv } from '@meshfrontlab/envguard';

assertEnv(); // checks process.env against .env.example, throws one clear error listing every problem
```

```text
Error: Invalid environment (2 problems):
  - PORT must be a port number (1-65535)
  - DATABASE_URL is missing (required)
```

### Options

| Option | What it does |
| --- | --- |
| `-e, --env <file>` | Env file to check (default `.env`). |
| `-x, --example <file>` | Example/schema file (default `.env.example`). |
| `-p, --process` | Check the real environment variables instead of a file. |
| `--strict` | Treat warnings as errors. |
| `--no-git-check` | Skip the "is `.env` safe from git?" check. |
| `--json` | Print `{ checked, errors, warnings, issues[] }` as JSON. |
| `--force` | With `init`: overwrite an existing example file. |
| `-q, --quiet` | Print nothing when everything is fine. |

**Exit codes:** `0` OK, `1` problems found, `2` bad usage or a missing file.

## Configuration: annotations

Every variable in `.env.example` is **required** unless marked otherwise. Put annotations in the comment lines right above a variable, or in a comment at the end of its line (`NODE_ENV=dev # @enum dev|prod`). Plain comment text is kept as the variable's description.

| Annotation | Meaning |
| --- | --- |
| `@type <type>` | `string` (default), `number`, `int`, `boolean`, `url`, `email`, `port`, `json`, `uuid` |
| `@optional` | May be missing. |
| `@allow-empty` | May be present but empty (`KEY=`). |
| `@enum a\|b\|c` | Must be one of these values. |
| `@pattern <regex>` | Must match this regular expression. |
| `@min <n>` / `@max <n>` | Number range (or text length for strings). |
| `@default <value>` | Documents a default; makes the variable optional. |

Annotations can share a line: `# @optional @type url`.

### Supported `.env` syntax

`KEY=value`, `export KEY=value`, `KEY="double quoted with \n escapes"`, `KEY='single quoted, literal'`, multi-line quoted values, `# comments`, trailing ` # comments` on unquoted values, Windows line endings.

## Contributing

Issues and pull requests are welcome.

```sh
git clone https://github.com/MeshFrontLab/envguard
cd envguard
npm test
```

Please keep it dependency-free, add tests for new behaviour, and make sure no message ever includes a variable's value.

## Licence

[MIT](LICENSE) © MESHFRONT LTD
