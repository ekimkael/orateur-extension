# Usage analytics setup and validation

Usage statistics are enabled by default when no preference has been saved.
Users can disable them in Settings → Privacy; a saved opt-out survives an
update. Events require a valid build-time PostHog configuration. Changing a
local configuration does not change an extension already installed by users.

Firefox also requires the browser's optional `technicalAndInteraction`
data collection permission. If that permission is absent or cannot be
checked, the extension sends no events even when its own switch is on.
The separate Orateur PDF companion does not send usage statistics.

## 1. Configure a test project

Use a dedicated PostHog test project so automated tests and developer
sessions do not mix with production usage.

Copy [.env.example](../.env.example) to `.env.local` at the extension root and
set the project's **public project key** and region:

```dotenv
WXT_POSTHOG_KEY=phc_actual_test_key
WXT_POSTHOG_REGION=eu
```

Replace the example key before building. The region must be exactly `eu` or
`us`, matching the PostHog project. Use a project key, never a personal API
key. The project key is bundled with the extension and is not a secret.
Keys must match `phc_` followed by letters, digits, underscores or hyphens;
placeholder keys containing `replace` or `your_project` are rejected.

Do not commit `.env.local`. Restart the development server or rebuild after
changing it: WXT embeds these variables at build time.

```bash
npm run compile
npm test
WXT_POSTHOG_KEY=phc_actual_test_key WXT_POSTHOG_REGION=eu npm run zip
WXT_POSTHOG_KEY=phc_actual_test_key WXT_POSTHOG_REGION=eu npm run zip:firefox
npm run test:packages
```

Replace `phc_actual_test_key` and the region with the test project's values.
Explicit shell variables override `.env.production.local`, which production
builds may also load. `.env.local` alone does not override that file when
creating a ZIP. Keep test events out of the production project.

Install the built package in a dedicated browser profile. Events leave from
the extension background, so inspect its network requests rather than only
the page being read. Requests go to
`https://eu.i.posthog.com/i/v0/e/` or
`https://us.i.posthog.com/i/v0/e/`, according to the configured region.

## 2. Validate the complete flow

Use a short demonstration text without personal data.

- [ ] With no key or an invalid region, enable statistics and start reading:
  no PostHog request should be sent.
- [ ] With valid configuration and a fresh profile, confirm **Share usage
  statistics** is on. Start reading and confirm `read_started` arrives in
  the test project with a stable random identifier.
- [ ] On Firefox, confirm no request is sent without the optional
  `technicalAndInteraction` permission. Grant it and repeat; revoking it
  must prevent subsequent events.
- [ ] Disable statistics, start reading, and reopen Settings. The switch
  stays off and no new PostHog request is sent.
- [ ] Re-enable statistics and confirm `telemetry_enabled` arrives.
- [ ] Start a system-voice reading. Confirm one `read_started` when audio
  begins. Pausing, resuming or changing speed must not count as a new first
  listen within that session.
- [ ] Let a short reading reach the end. Confirm `read_completed`, its
  `engine` and `had_errors` properties.
- [ ] Exercise a controlled synthesis or audio playback failure in tests.
  Confirm `read_failed` contains a fixed category, never a free-form error.
- [ ] Inspect each payload: only the expected event properties and
  `extension_version`; no article title, text or URL. Requests omit
  credentials and the referrer.
- [ ] Restart the browser. While statistics remain enabled, another reading
  must retain the same `distinct_id`.
- [ ] Disable statistics and confirm the local identifier is cleared.
  Re-enable them and confirm the next event uses a different identifier.
- [ ] Update a profile that had opted out. It must remain opted out,
  without a new identifier or event.
- [ ] Read again the next day in the same profile to verify that the events
  can measure a return on another day.

Also test Supertonic when its models are available. Automated tests do not
establish real voice or sound quality. See [the testing guide](testing.md)
for browser scenarios, network isolation and audio-test limitations.

## 3. Event contract

| Event | Meaning and allowed properties |
| --- | --- |
| `telemetry_enabled` | A user re-enables statistics in Settings. Default activation does not emit this event; it is not an installation count. |
| `read_started` | First confirmed audio start in a session; `engine`: `system` or `supertonic`. Requests that fail before audio do not count. |
| `read_completed` | The reader reaches the end after audio starts; `engine` and `had_errors`. Users can skip passages, and some passages may fail, so this does not prove the whole article was heard. |
| `read_failed` | Reading failure, at most once per session; `engine` and `reason`: `synthesis`, `audio_playback` or `preparation`. |
| `supertonic_offered` | The user chooses Supertonic in the reading pill's settings. |
| `supertonic_download_started` | Model download begins during a reading. |
| `supertonic_download_completed` | That model download completes. |
| `supertonic_download_failed` | That model download fails; `reason`: `http`, `network` or `unknown`. |
| `extraction_failed` | Extraction fails or falls back; `reason`: `not_injectable`, `not_article`, `pdf` or `fallback_text`. |

These are the events emitted by the main extension. Downloads started
directly from the options page do not emit the reading pill's download
events. The background adds `extension_version` and validates the event
catalogue at runtime, rejecting unknown fields or values. Only that
background handler sends network requests; content scripts relay events
through extension messages. There is no page autocapture or session replay.

The random identifier represents a browser profile with statistics enabled,
not an identified person. Reinstallation, another profile or an opt-out
breaks that continuity. Statistics omit opted-out profiles and blocked or
lost events. No events are queued or retried, and past activity is not
reconstructed after activation. Disabling statistics does not delete events
already received by PostHog.

## 4. Prepare publication

After test validation, use a separate production project. Configure its
public key and region in the environment that builds the published archives:

- Local production builds may use `.env.production.local`.
- In GitHub, open **Settings → Secrets and variables → Actions → Variables**
  and add `WXT_POSTHOG_KEY` and `WXT_POSTHOG_REGION`. The release workflow
  passes them to WXT; local environment files are not present in Actions.
  Publication fails if the key or region is missing or invalid.

For the shared [Orateur EU project](https://eu.posthog.com/project/225977),
filter on `extension_version` to distinguish extension events from web
application events.

Check the final package configuration and the store privacy disclosures
before submission. If a reviewer needs to reproduce a configured build,
provide the public project values and build instructions. Never provide a
personal PostHog API key.

Collection starts when a configured version is installed, statistics are
enabled, and Firefox's additional permission is granted where applicable.
Local validation, store publication, installation and receipt of events
remain separate states.

## 5. Start with three measurements

1. **Listeners:** distinct identifiers with `read_started`, grouped by day
   and extension version.
2. **Returns:** a retention report using `read_started` as both the initial
   and returning event. Use daily intervals and allow users time to return.
3. **Blockers:** `read_failed` and `extraction_failed`, grouped by category,
   engine where available, and version.

Installation and uninstallation counts come from the store consoles. Do
not divide tracked listeners by all installations and present that as an
overall activation rate. Event counts are not user counts.

Combine these measurements with [manual first-user follow-up](premiers-utilisateurs.md),
keeping names and contact details out of PostHog. Missing events can also
mean an opt-out, an older version or a blocked request.

## Implementation references

- [Telemetry event validation, consent and sending](../lib/telemetry.ts)
- [Firefox data collection declaration](../wxt.config.ts)
- [Release workflow](../.github/workflows/release.yml)
- [Privacy policy](../PRIVACY.md)
- [WXT environment variables](https://wxt.dev/guide/essentials/config/environment-variables.html)
- [PostHog retention reports](https://posthog.com/docs/product-analytics/retention)
