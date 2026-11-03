## What and why

<!-- What changes, and the reason. Link the spec or issue if there is one. -->

## Behavior

Describe the problem, expected result and existing guarantees to preserve.
Identify any reduced guarantee and its effect on users.

## Verification

- [ ] `npm run compile`, `npm test`
- [ ] `npm run test:packages`, `npm run test:e2e`, `npm run test:e2e:firefox` (build, manifest or lifecycle changes)
- [ ] checked in the running extension in Chrome and Firefox (if user-visible)
- [ ] bug and security review after green CI

- Bug fixes: reproduction and evidence of failure with the defect, then success with the fix.
- Changed or removed assertions: justification against product guarantees.
- Automated results: commands and outcomes; identify simulated behavior.
- Required real checks: result per browser, commit/version and tested-package hash.
- Checks not run, interrupted or failed: name them explicitly.

For playback, translation or preloading changes, verify audio lookahead with
and without text preparation, then complete a Chrome and Firefox walkthrough
including short headings. Document `preparing-next` waits and real listening
according to [the QA protocol](https://github.com/ekimkael/orateur-extension/blob/HEAD/docs/testing.md).
A pending required check blocks publication.

## Not verified

<!-- Anything skipped or that still needs a real check. Write "Nothing" if so. -->

## Changelog

<!-- Only for a breaking change or a migration: the line added under [Unreleased]. Otherwise "Drafted from commits". -->
