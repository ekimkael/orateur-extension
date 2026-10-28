# Privacy policy — Orateur

*Last updated: 28 October 2026*

**Usage statistics are on by default when no preference has been saved.**
You can turn them off in Settings → Privacy. An existing opt-out remains
respected after updates. Sending statistics also requires a configured build
and, on Firefox, the browser's optional data collection permission. Reading
with the extension requires no account.

## Page access

The main extension accesses page content to extract an article or read your
selection. Extraction takes place in your browser. The extension does not
automatically upload page content or browsing history.

The selection bubble and reading pill run on supported pages. Article
extraction runs when you request it. You can hide these controls on selected
domains in Settings → Sites.

## Network requests

### 1. Sending content to Orateur

Clicking the toolbar icon or choosing a read-later context-menu action opens
`https://orateur.digitalekim.net`.

When extraction succeeds, the article or selected text, title, language and
source URL, when available, travel in the URL fragment after `#orateur=`.
The fragment is not included in the HTTP request to the server. It is read
by the Orateur web application, whose subsequent storage and processing are
separate from in-page extension playback.

If extraction cannot run on a transferable page, the extension can instead open
Orateur with the source URL and optional title in query parameters. These
parameters reach the web server so Orateur can fetch the page itself.

Reading a page or selection in place does not send its content to Orateur.

### 2. Speech engines and model downloads

New installations default to Supertonic. Updates preserve saved engine choices;
existing installations without a saved engine keep the system voice. You can
change the engine in the reading pill or Settings.

The system engine uses the browser's `speechSynthesis` API. The extension
does not download its own model for this engine. Available voices come from
the browser or operating system; whether a voice uses a network service
depends on that voice and its provider.

Supertonic runs speech synthesis locally. First playback with this engine,
or an explicit model download from Settings, downloads approximately
400 MB of public models and voice styles from the
`Supertone/supertonic-3` repository on `https://huggingface.co`. These files
are cached in the extension's private storage (OPFS). A complete cache
allows offline synthesis; missing files may require another download.
Private windows without cached models use the system engine instead of starting
a download that may not persist.

Model requests contain no article or selected text. Hugging Face and its
download infrastructure receive the network metadata needed to serve the
files, such as the requesting IP address. The text synthesized by Supertonic
stays on your device.

### 3. Optional usage analytics

The **Share usage statistics** switch in Settings → Privacy is on by default
when no preference exists. When enabled in a configured build, the main
extension sends a limited set of events to [PostHog](https://posthog.com):

- Re-enabling statistics in Settings.
- The first confirmed audio start, reaching the end of a reading, and
  whether that reading encountered errors.
- Reading failures, with the engine and a fixed category: preparation,
  synthesis or audio playback.
- Choosing Supertonic in the reading pill, and model download starts,
  completions or failures with a fixed failure category.
- Extraction failures or fallbacks with a fixed category.

Each event includes the extension version and, when available, the browser
name and its major version. The raw User-Agent is not included in event
properties. Only the events and properties listed in
[the analytics guide](docs/analytics.md) are accepted. Missing or invalid
build configuration prevents sending events. Firefox additionally requires
its optional `technicalAndInteraction` permission; if that permission is
absent or cannot be checked, no events are sent.

**Statistics never include article text, page URLs or titles, browsing
history, names or email addresses.** A random UUID identifies the same
browser profile while statistics remain enabled. It is generated locally
and is not linked to an account. It is a persistent pseudonymous identifier,
not a guarantee of anonymity: PostHog also receives the network metadata
needed for the request. Requests omit credentials and the referrer.

Turning statistics off prevents subsequent events and deletes the local
UUID. Re-enabling them generates a new UUID. Disabling statistics does not
delete events already received by PostHog. Events are not queued or retried,
and past activity is not reconstructed after activation.

## Local storage

The main extension stores:

- Reading preferences: engine, voices, speed, follow mode and pill position.
- Interface theme and language, hidden domains and personal pronunciation
  rules.
- Reading progress: page URL, title when available, current block, block
  count and last update time. These records support resuming a reading.
  Records older than 30 days are discarded when progress is next loaded;
  finishing an article clears its saved progress.
- A coordination token so only one tab reads at a time.
- Supertonic models and voice styles, if downloaded.
- The statistics preference and its random UUID while enabled.

These values use local extension storage, not browser sync. They are not
included in usage statistics. You can delete downloaded Supertonic models
from Settings. Uninstalling an extension removes its local storage.

## Permissions

| Permission | Purpose |
| --- | --- |
| Site access (`<all_urls>`) | Display the selection bubble and reading pill on supported pages and extract content when requested. |
| `activeTab` | Act on the current tab after a toolbar or context-menu action. |
| `contextMenus` | Add reading and read-later actions. |
| `scripting` (Chrome MV3) | Inject the extractor or reader when needed. |
| `storage` | Save preferences, pronunciation rules, reading progress and statistics settings; coordinate reading tabs. |
| `unlimitedStorage` | Allow the Supertonic model cache to exceed ordinary storage limits. |
| `offscreen` (Chrome MV3) | Run Supertonic audio playback in a document outside the service worker. Firefox uses its persistent background page. |
| `technicalAndInteraction` (Firefox, optional) | Allow usage statistics in addition to the extension's own switch. |

## Contact

Questions or issues: [Orateur extension issue tracker](https://github.com/ekimkael/orateur-extension/issues).
