# Testing and regression prevention

Checks cover business logic, module integration and the built extension loaded
in a browser. A successful build alone does not prove the browser accepts the
extension.

## Run the checks

Use Node.js 24 and the repository dependencies:

```bash
npm ci
npm run compile
npm test
```

`npm test` runs the Node tests in `lib/**/*.test.ts` and `tests/*.test.mjs`.
Package and browser checks use production ZIPs, without a WXT development server:

```bash
npm run zip
npm run zip:firefox
npm run test:packages

npm exec puppeteer browsers install chrome
npm exec puppeteer browsers install firefox
npm run test:e2e
npm run test:e2e:firefox
```

Browser downloads are explicit; `npm ci` does not install them. Puppeteer caches
its browsers in `.cache/puppeteer`. CI uses these managed versions. To diagnose
an issue with another installed binary, supply its absolute path:

```bash
ORATEUR_BROWSER_PATH="/absolute/path/to/firefox" npm run test:e2e:firefox
```

This override is for diagnosis; report the browser version actually executed.
`ORATEUR_TEST_BROWSER=firefox npm run test:e2e` also selects Firefox; the explicit
browser argument used by `test:e2e:firefox` takes precedence.

Diagnostics go to `.output/test-results`: page screenshots, console output,
page errors, blocked requests, browser version and ZIP hashes. These observations
do not guarantee detection of every service worker error; Firefox may also omit
extension-page errors from its events. `e2e/<browser>-runtime.json` identifies
the binary and version even after successful runs. Each invocation removes old
diagnostics for that browser so separate runs cannot be confused. Package
validation writes `packages.json` and `packages.sha256`; browser results also
include `e2e/<browser>.xml` in JUnit format.

The main browser suite covers persistent settings, reading in an already-open
tab, pause/resume/stop, mouse selection, keyboard controls, paragraph navigation,
speed, playback handoff between tabs, site exclusions, pronunciation rules and
speech/model-download failures. Toolbar handoff is tested on Chrome; Firefox
explicitly skips that scenario because its driver cannot trigger the action.
Translation scenarios check current DOM text and detected language. A saved
system voice is applied only when its base language matches; otherwise the
browser chooses a voice while the saved preference remains unchanged.
Analytics scenarios check default
consent, persistent opt-out and reading-event timing, without sending production
analytics. See [analytics validation](analytics.md) for its separate live checks.

Built-in PDF viewers reject the injected reader. Manually verify that in-place
reading reports the limitation and that **Listen to selection later** transfers
selected text when the browser exposes it. These checks do not establish
full-document PDF support.

## Choose the appropriate level

- **Node tests:** extraction, chunking, pronunciation, navigation, preferences,
  caching and audio scheduling. Cover limits and errors quickly.
- **ZIP validation:** actual paths, manifest, translations and runtime assets.
  Validate the archives intended for submission.
- **Browser tests:** installation and communication between compiled components,
  using stable local pages and an isolated profile per test. Installation,
  messaging and storage are real; speech is simulated for deterministic results.
- **Manual checks:** audible output, voice quality, visual behavior and
  interactions the browser driver cannot cover.

Simulated audio checks reader commands and state transitions. It does not prove
a system voice exists on the device or that any sound is emitted.

## Protection matrix

These are behaviors to protect. A row does not mean every scenario already has
an E2E test.

| Feature | Contract | Main level |
| --- | --- | --- |
| Installation | Accepted ZIP, accessible assets, background startup | Package + browser |
| Extraction | Relevant article, intact selection, fallback without article, long text | Node + browser |
| Playback | Start, pause, resume, stop, progress, paragraph changes | Node + browser + listening |
| Selection | Bubble, immediate reading, iframe selections, editable fields | Node + browser |
| Settings | Applied value, persistence after reload, reader updates | Node + browser |
| Pronunciation and languages | Substitutions, numbers, language, input limits | Node + manual preview |
| Lifecycle | Existing tab, navigation, closure, multiple tabs, updates | Browser |
| Supertonic | Download, cancellation, network failure, cache, offline playback | Node + browser + dedicated check |
| Privacy | Enabled by default, stops after opt-out, native Firefox permission required | Node + network observation |
| Web application | Correct text, title, language and URL handoff | Node + browser |
| Built-in PDF viewer | No injected reader; selected-text handoff when exposed by the browser | Manual |
| Accessibility | Keyboard, accessible names, focus, contrast, announced states | Browser + manual review |

## Stable, useful tests

Test observable behavior and meaningful failures without copying implementation
into assertions. A bug fix needs a regression test that fails with the old
behavior and passes with the fix.

### Preserve existing contracts

Before changing behavior, identify the bug and the existing guarantees to
preserve. Assertions follow those guarantees, rather than the new code's output.
Call out any removed or reduced guarantee in the PR as a product change and
explain its user impact; changing a test to accept it is not justification.

For Supertonic playback, protect the same contract with and without translated
text preparation. On text containing at least seven units whose preparation is
available, allow simulated synthesis to finish and require the current unit plus
the next six before ending the current audio, including across paragraph
boundaries. Transitions to ready audio must not emit `preparing-next`. Actual
synthesis that is slower than playback may legitimately wait; keep that case
distinct.

Include long paragraph → short heading → body, a heading still awaiting
translation, pause/resume and seeking during preparation. Use controlled promises
to observe event order and available units before playback ends; do not always
finish all work before asserting.

Run the regression test against both the faulty behavior and the fix, and retain
both results in the PR. If the old version cannot run the test, temporarily
reintroduce the defect in an isolated copy and confirm it fails for the expected
reason. Never publish that copy or mix its evidence with the fix's results.

Review changed assertions against the stated guarantees. For scheduling changes,
obtain an independent review of this contract: loss of lookahead, caching or
responsiveness must not become a new test expectation.

Keep fixtures local: no changing third-party articles or model downloads in fast
tests. Each scenario creates its own profile and data. A test proxy limits network
access to local fixtures. Wait for a precise event or state with a bounded
timeout; avoid fixed delays. A successful retry must not conceal a flaky test.

Keep the existing Node test framework. Add browser coverage when failure depends
on manifests, permissions, messages, storage or real extension lifecycle. An
arbitrary line-coverage target cannot replace behavior coverage.

## Browser and audio limits

On GitHub's Ubuntu runners, Chrome for Testing uses the installed Chrome SUID
sandbox via `CHROME_DEVEL_SANDBOX=/opt/google/chrome/chrome-sandbox`. The workflows
check that helper exists before browser tests; Chrome's sandbox stays enabled.
See [Chromium's AppArmor guidance](https://chromium.googlesource.com/chromium/src/+/main/docs/security/apparmor-userns-restrictions.md).

Puppeteer uses Chrome for Testing on Chrome and WebDriver BiDi on Firefox.
Browser versions must remain identifiable and tied to installed tooling. Firefox
does not support every Chrome-driver feature, including extension actions and
Puppeteer's exposed content-script contexts. A Chrome scenario does not establish
Firefox behavior.

Access to `moz-extension:` pages requires Firefox automation mode
`MOZ_REMOTE_ALLOW_SYSTEM_ACCESS=1`, documented by Mozilla. The harness applies
it only to the test process: a fresh temporary profile, Remote Agent bound to
loopback and external requests rejected by the proxy. It lets the driver inspect
installed extension pages; no user profile is opened. It is not part of published
ZIPs.

Firefox filters some extension-page lifecycle events even in this mode. The
harness therefore uses BiDi `browsingContext.navigate` and
`browsingContext.reload` with `wait: "none"`, then waits for a DOM state with a
bounded timeout, without depending on missing load events.

The reader and bubble retain their closed Shadow DOM, as in published packages.
A helper in the extension context uses Chrome's
`chrome.dom.openOrClosedShadowRoot()` or Firefox's `element.openOrClosedShadowRoot`
to read accessible names and control positions. The driver then clicks those
coordinates. No special build or change to Shadow DOM mode is needed. Visual
review and keyboard paths outside the suite remain complementary checks.

System voices depend on the machine. Before a release affecting audio, listen
to an article and a selection on both Chrome and Firefox, then check pause,
resume, stop, speed and voice changes. For Supertonic, use a fresh profile,
check the initial download of about 400 MB, cancel and retry, then restart offline
to verify the cache and audible playback. These costly checks complement fast
tests, which do not download models for each PR.

For lifecycle changes, also check installation into an already-open tab, updates
during playback and MV3 service-worker wakeup. Attaching a debugger can affect
the worker's sleep behavior.

## Release gate

CI checks code and built archives. Its `packages` job builds the extension
runtime ZIPs, then the Chrome and Firefox jobs test those same artifacts.
The final `build` check requires successful package and browser jobs; failure,
cancellation or a skipped job blocks it.

Release runs its own compilation, Node, package and Chrome/Firefox checks before
submission. A passing PR does not validate a later rebuild. The release workflow
validates production PostHog configuration before packaging and verifies runtime
ZIP hashes before store submission and GitHub release creation. The generated
Firefox source archive is excluded from package validation and hash checks.
Do not rebuild archives between validation and submission.

For playback, translation or preloading changes, also attach a completed real
Chrome and Firefox walkthrough: an article containing long paragraphs and short
headings, with progressive translation when relevant. Record `preparing-next`
events, their duration until playback resumes, errors and audible pauses.
Explain remaining waits using measurements before claiming smooth playback;
passing tests and simulated-voice events do not replace this check.

Reports distinguish automated tests, real checks and checks not performed, with
commit, browser/version and tested-package hash. An interrupted or unperformed
required check remains pending and blocks publication; do not describe the fix as
fully validated. A rebuild or code change invalidates evidence for the previous
package.

On failure, block submission and retain available diagnostics: scenario name,
browser, errors, screenshots and archive hashes. Browser-installation or setup
failures before a scenario must be diagnosed from command logs. PR tests do not
require publishing credentials.

## Official references

- [Chrome: extension E2E testing](https://developer.chrome.com/docs/extensions/how-to/test/end-to-end-testing)
  — built packages, visible behavior and service-worker debugging limits.
- [Puppeteer: extensions](https://pptr.dev/guides/chrome-extensions)
  — installation and extension-context interaction.
- [Puppeteer: Firefox and WebDriver BiDi](https://pptr.dev/webdriver-bidi)
  — capabilities and unsupported features.
- [Mozilla: Remote Agent security](https://firefox-source-docs.mozilla.org/remote/Security.html)
  — explicit system access for automation and loopback connections.
- [Mozilla: browsing-context filtering](https://raw.githubusercontent.com/mozilla-firefox/firefox/main/remote/shared/BrowsingContextUtils.sys.mjs)
  and [extension-page event tracking](https://bugzilla.mozilla.org/show_bug.cgi?id=1755014)
  — limits handled by BiDi navigation and DOM waits.
- [MDN: extension access to closed Shadow DOM](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/dom/openOrClosedShadowRoot)
  — the Chrome method and Firefox property used by test helpers.
- [Playwright: best practices](https://playwright.dev/docs/best-practices)
  — isolation, behavior assertions and controlled external dependencies; these
  principles also apply to this repository's Puppeteer tests.
- [Mozilla: web-ext](https://extensionworkshop.com/documentation/develop/web-ext-command-reference/)
  — static validation and running Firefox extensions.
- [MDN: SpeechSynthesis.getVoices()](https://developer.mozilla.org/en-US/docs/Web/API/SpeechSynthesis/getVoices)
  — voices available on the device.
