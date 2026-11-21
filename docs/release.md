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
6. On the `main` PR, wait for the [Security workflow](../.github/workflows/security.yml). Reuse the successful `dependencies`
   (`npm audit --audit-level=high`) and `secrets` (Gitleaks) jobs for the current PR revision. Record the PR head SHA and link
   both jobs in the PR. Refresh the evidence if the tested revision changes.
   Review changes to extension permissions and host access, message validation between components, telemetry consent and
   payloads, page content handling, and store credentials. Record findings in the PR. An open high or critical finding blocks the merge.
   Complete the manual Chrome and Firefox QA from the PR template and [testing.md](testing.md) on the release packages.
7. Merge the `main` PR (merge commit).
8. Get the merge SHA with `gh pr view <main-pr> --json mergeCommit --jq .mergeCommit.oid`.
   Find its store submission run with `gh run list --workflow release.yml --event push --branch main --commit <merge-sha>`
   and wait for it to succeed with `gh run watch <run-id> --exit-status`. If a store job fails, follow
   [the targeted retry procedure](#retry-a-store-submission) before tagging.
9. After success, check `git ls-remote origin 'refs/tags/vx.y.z' 'refs/tags/vx.y.z^{}'`.
   If the lookup succeeds and returns no refs, `/release` shows the command and waits for a repository admin to run it.
   `git tag -a vx.y.z -m "Release x.y.z" <merge-sha> && git push origin vx.y.z`
10. The tag push starts a separate run of the [same workflow](../.github/workflows/release.yml) to publish the GitHub Release
    with the submitted ZIPs. On resuming `/release`, repeat the remote tag lookup and verify that the `^{}` entry matches
    the merge SHA. Follow the run for that tag if publication is pending. Confirm `isDraft` is false and `publishedAt` is set
    with `gh release view vx.y.z --json isDraft,publishedAt,url`. Stop if the tag fails verification or the publication run fails.
11. After both checks pass, merge the `develop` PR, delete `release/x.y.z`, and fast-forward local `main` and `develop`.

Never move or delete a published tag. A bad release is fixed by a new `hotfix/x.y.z`.

## Project specifics

- **Targets:** Chrome Web Store and Firefox Add-ons (AMO) are required. The workflow checks for their identifiers and
  credentials before submitting to either store. Edge is included only when its product ID is configured.
- **Trigger:** a push to `main` (the release PR merge) runs [the release workflow](../.github/workflows/release.yml).
  It checks the version and changelog, runs `compile`, `test`, the PostHog configuration check, both ZIPs, `test:packages`
  and the Chrome/Firefox browser suites. It archives the ZIPs for 30 days before starting a separate submission job for
  each configured store. Each job verifies the checksums and uses that artifact. Only after all store jobs succeed does
  `release-ready` print the tag command. The tag run publishes the GitHub Release with the Chrome, Firefox and source
  archives from that run. Push the tag within 30 days so those archives are still available.
- **`store` environment:** holds the store secrets; deployments only from `main` and `v*` tags. `v*` tags can only be created
  by repository admins (ruleset "Release tags").
- **Actions variables:** `WXT_POSTHOG_KEY` and `WXT_POSTHOG_REGION` (`eu` or `us`) must be set, or the release fails before packaging.
  See [analytics.md](analytics.md).
- **Dry run:** run the workflow manually with `dry_run` to check store authentication without uploading or submitting.
  A real manual run must start from `main`. Manual runs keep ZIPs for seven days for job retries. The tag run uses the ZIPs
  from the workflow triggered by the merge into `main`.
- **Manual QA (the user's call):** real listening with system and Supertonic voices in Chrome and Firefox, and the walkthrough
  in [testing.md](testing.md), before merging into `main`. Store-side reviews happen after submission.
- **Rollback:** stores have no rollback. Publish a `hotfix/x.y.z` with the fix or the revert.

## Retry a store submission

1. Open the original `Release` run in Actions and read the failed `Submit (chrome)` or `Submit (firefox)` job log. Check
   that version in the store's developer dashboard. A job can fail after the store receives the ZIP or the submission.
2. If the version is absent and the original ZIP is still valid, fix the cause and use **Re-run job**
   on that store job only. For example, retry `Submit (firefox)` when Chrome is already green. GitHub reruns the dependent
   `release-ready` job and the selected store job verifies and reuses the original ZIPs.
3. If that version already exists as a draft, check what is missing in the store dashboard before uploading anything else.
   If the store already received the submission, record its status and leave it in place. A failed run keeps the tag on
   hold. Use a new `hotfix/x.y.z` if recovery requires changing the package or the validated artifact is unavailable.

Use the targeted job retry once any store has started submitting. A full run can attempt to submit a version the store
already has.
