# Changelog

All notable changes to this project are documented here. This project follows [Semantic Versioning](https://semver.org).

## [0.1.0] - 2026-11-24

First release.

### Added

- `envguard` checks a `.env` file against `.env.example`: missing, empty, invalid, duplicated and undocumented variables.
- Annotations in `.env.example` comments: `@type`, `@optional`, `@allow-empty`, `@enum`, `@pattern`, `@min`, `@max`, `@default`.
- Types: string, number, int, boolean, url, email, port, json, uuid.
- Git safety check: warns when `.env` is not ignored, fails when it is committed.
- `envguard init` creates `.env.example` from `.env` with values removed and obvious types filled in.
- `--process` mode for checking real environment variables in CI and containers.
- `--json`, `--strict`, `--quiet`, `--env`, `--example` options.
- `assertEnv()` and other functions for use from code.
- Values are never printed.

[0.1.0]: https://github.com/MeshFrontLab/envguard/releases/tag/v0.1.0
