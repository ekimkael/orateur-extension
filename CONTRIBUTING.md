# Contributing

Everything committed is written in English: code, comments, commits, PRs, changelog, docs.

## Setup

Use Node.js 24 and npm 11.

```bash
npm ci
cp .env.example .env.local   # optional: development analytics, see docs/analytics.md
npm run dev                  # or npm run dev:firefox
```

Commands, structure and known traps: [AGENTS.md](AGENTS.md). Tests and manual QA: [docs/testing.md](docs/testing.md).

## Git Flow

- `main`: releases only. Never commit or push to it directly.
- `develop`: integration branch and GitHub default branch.
- `feature/*`, `fix/*`, `refactor/*`, `docs/*`, `chore/*`: branch off `develop`, PR back into `develop`.
- `release/x.y.z`: branch off `develop`, PR into `main`, then PR into `develop`.
- `hotfix/x.y.z`: branch off `main`, PR into `main`, then PR into `develop`.
- Every PR is merged with a merge commit (no squash, no rebase) once CI is green (`build`, `packages`, `browser-tests (chrome)`, `browser-tests (firefox)`, plus the `guard` Git Flow check and the `Security` workflow: gitleaks, `npm audit --audit-level=high`, actionlint and zizmor).
- A feature is finished once its PR is merged into `develop`, its branch is deleted locally and remotely, and local `develop` is up to date. Finishing a feature does not publish a release.

## Commits

[Conventional Commits](https://www.conventionalcommits.org/): `type(scope): description`.
Types: `feat`, `fix`, `refactor`, `perf`, `docs`, `test`, `ci`, `chore`. Common scopes: `reader`, `tts`, `extract`, `selection`, `options`, `pronunciation`, `telemetry`.
The changelog is drafted from these messages, so write them for a reader.

## Pull requests

Fill in [the PR template](.github/pull_request_template.md). A PR states:

- what changes and why, and which existing guarantees it preserves or reduces;
- how it was verified (commands run, browsers, manual checks);
- anything not verified.

Playback, translation or preloading changes also need the real Chrome and Firefox walkthrough from [docs/testing.md](docs/testing.md). A pending required check blocks publication.

## Changelog

Feature PRs don't edit `CHANGELOG.md`. Exception: a breaking change or a migration adds a line under `[Unreleased]` by hand.
The release section is drafted from commits at release time, rewritten for store users and contributors, and reviewed in the release PR. `npm run validate:changelog` checks the format.

## JSDoc

Every export (function, hook, component, type) gets at least a one-line `/** */`.
Non-obvious internal code documents its responsibility, its invariants and why it is shaped that way.

## Release

See [docs/release.md](docs/release.md).
