## Behavior

Describe the problem, expected result and existing guarantees to preserve.
Identify any reduced guarantee and its effect on users.

## Verification

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
