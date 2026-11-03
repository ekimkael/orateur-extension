# Release

Git Flow release. Agents run it with the `/release` skill; this page is the reference.

## Naming

| Item | Format |
|---|---|
| Branch | `release/1.4.0` (`hotfix/1.4.1` from `main`) |
| Commit | `chore(release): 1.4.0` |
| Tag | annotated `v1.4.0` |
| PR title | `Release 1.4.0` |

## Steps

1. From an up-to-date `develop` (or `main` for a hotfix), create `release/x.y.z`.
2. Bump the version: `npm version x.y.z --no-git-tag-version`.
3. Draft the changelog section from the commits since the last tag:
   `git cliff --unreleased --tag vx.y.z --strip header` (or `git log <last-tag>..HEAD` without git-cliff).
   Rewrite it for humans: group related commits, drop `chore`/`ci`/`test`, describe the impact.
   Manual lines already under `[Unreleased]` come first. Insert it as `## [x.y.z] - YYYY-MM-DD` under an empty `## [Unreleased]`.
4. `node scripts/validate-changelog.mjs x.y.z`.
5. Commit `chore(release): x.y.z`, push, and open two PRs: into `main`, then into `develop`.
6. Once CI is green on the `main` PR: `npm audit --audit-level=high`, a gitleaks scan, and a security review of risky areas
   (page content handling, message passing, telemetry payloads, store credentials).
   No merge with an open high or critical finding.
   Complete the manual Chrome and Firefox QA from the PR template and [testing.md](testing.md) on the release packages.
7. Merge the `main` PR (merge commit).
8. Tag the merge commit on `main` right after the merge: there is no auto-deployment, the tag triggers the store submission.
   `git tag -a vx.y.z -m "x.y.z" <merge-sha>`
9. Push the tag. The release workflow creates the GitHub Release with generated notes; replace them with the changelog section
   (`gh release edit vx.y.z --notes-file <section.md>`).
10. Merge the `develop` PR, delete `release/x.y.z`, fast-forward local `main` and `develop`.

Never move or delete a published tag. A bad release is fixed by a new `hotfix/x.y.z`.

## Project specifics

- **Targets:** Chrome Web Store and Firefox Add-ons (AMO). Edge is wired in the workflow but has no credentials, so it is skipped.
- **Trigger:** pushing a `v*` tag runs [the release workflow](../.github/workflows/release.yml). It fails unless the tagged commit
  is on `main` and the tag equals `v` + `package.json` version, then runs `compile`, `test`, the PostHog configuration check,
  both ZIPs, `test:packages` and the Chrome/Firefox browser suites, submits the exact validated ZIPs (hash-checked) and creates
  the GitHub Release with the Chrome, Firefox and source archives.
- **`store` environment:** holds the store secrets; deployments only from `main` and `v*` tags. `v*` tags can only be created
  by repository admins (ruleset "Release tags").
- **Actions variables:** `WXT_POSTHOG_KEY` and `WXT_POSTHOG_REGION` (`eu` or `us`) must be set, or the release fails before packaging.
  See [analytics.md](analytics.md).
- **Dry run:** run the workflow manually with `dry_run` to check store authentication without submitting. A real manual run must start from `main`.
- **Manual QA (the user's call):** real listening with system and Supertonic voices in Chrome and Firefox, and the walkthrough
  in [testing.md](testing.md), before merging into `main`. Store-side reviews happen after submission.
- **Re-running:** a re-run resubmits to every configured store, and stores refuse a version they already have.
  Ship a fix as a new patch version instead.
- **Rollback:** stores have no rollback. Publish a `hotfix/x.y.z` with the fix or the revert.
