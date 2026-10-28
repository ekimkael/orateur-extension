# Project Rules

These instructions apply to all coding agents working in this repository.

## Git Flow

- Follow Git Flow as the required Git strategy. `main` contains releases; `develop` is the integration branch.
- Create `feature/*` branches from `develop` and merge them back into `develop` through pull requests.
- Create `release/*` branches from `develop`; prepare the version there, merge into `main`, tag the release, then merge back into `develop`.
- Create urgent `hotfix/*` branches from `main` and merge them into both `main` and `develop`.
- Never commit or push directly to `main`. Require passing CI before merging pull requests.
- Follow [the release guide](README.md#git-flow-and-releasing) for packaging, tagging, and publication.

## Other Rules

- Write documentation, code comments, commit messages, pull requests, changelogs, and releases in English.
- PDF development, packaging and publication are excluded unless the user explicitly requests PDF. Do not propose PDF work or ask whether to include it by default.
