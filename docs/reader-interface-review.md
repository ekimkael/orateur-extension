# Floating reader interface review

Scope: the reader shown over Gmail, its settings, and idle, extraction, loading,
download, playing, paused and error states. WXT/TypeScript, native DOM controls,
closed shadow-root CSS and existing `charteTokens`; no new dependencies.
Project conventions inspected: `CLAUDE.md`, `README.md`. Options and selection
interfaces were excluded, except the shared dark text token correction.

The requested design and UX improvements were implemented after a source audit
and inspection of the supplied screenshot. Animation findings were independently
reviewed before and after implementation.

## Coverage

| Domain | Evidence inspected | Result |
| --- | --- | --- |
| Accessibility | Names, native controls, hidden/inert settings, Enter/Tab/Escape, focus rings, error announcement markup, motion guards | Confirmed findings resolved; screen reader not verified |
| Layout | All six dock positions at 320px; settings, all reader states, long title at 320×450 | Confirmed clipping resolved |
| Writing | FR/EN labels, loading reasons, retry/recovery, action names | Duplicate and misleading status resolved |
| Typography | Wrapped article title, 14px title, 13px status, tabular metadata, settings labels | Title remains readable and distinct from status |
| Colors | Computed dark colors and measured token pairs; light theme rendering | Muted text contrast corrected |
| UI polish | Primary/secondary hierarchy, 36px controls, 40px primary control, pointer/keyboard and loading states | One coherent reader surface; unnecessary layout motion removed |

## Resolved findings

Locations refer to the resulting implementation.

| Severity | Domain | Location | Before | After | Why |
| --- | --- | --- | --- | --- | --- |
| HIGH | Accessibility | `entrypoints/reader.content.ts`, `createPill` settings | Invisible settings remained tabbable | Closed settings are inert; keyboard opening focuses engine; Escape restores trigger; leaving closes settings | Prevents invisible focus stops |
| HIGH | Layout | `entrypoints/reader.content.ts`, `PILL_CSS` and `fitPopover` | Expanded reader and centered settings could exceed narrow viewport | Viewport-capped widths, correct center docking and settings height based on actual reader height | Keeps controls reachable at 320px, including long titles |
| HIGH | Colors | `lib/charte.ts:36` | `#7a7a7a` on `#161616`: 4.216:1 | Reuse options token `#838383`: 4.773:1 | Clears normal-text 4.5:1 requirement |
| HIGH | Writing | `entrypoints/reader.content.ts:311`, `:357` | Errors folded reader with no in-page recovery | Persistent recovery message and named retry control | Gives a visible next action |
| HIGH | Accessibility | `entrypoints/reader.content.ts`, `PILL_CSS` motion guards | Reduced motion still rotated spinners | Rotation and progress transitions opt in to `no-preference` | Keeps static loading text when motion is reduced |
| MEDIUM | Layout | `entrypoints/reader.content.ts`, `setState` | Loading label appeared twice; title was overwritten; waiting expanded a card | Loading stays in a pill with a spinner and inline status; title retained for playback | Removes duplicate floating UI and preserves context |
| MEDIUM | Accessibility | `entrypoints/reader.content.ts`, `setState` | Loading primary control attempted pause/resume before audio was ready | Disabled primary announces loading status; stop remains available for interruptible waits | Controls describe supported actions |
| MEDIUM | Layout | `entrypoints/reader.content.ts`, `setState` download | Download showed a card and text; bar depended on the first percentage | Compact pill with cloud-download, inline progress and percentage; track present before progress arrives | Keeps waiting feedback in the requested shape |
| MEDIUM | UX | `entrypoints/reader.content.ts`, `onTtsEvent` | Late download events could reopen loading after stop | Ignore TTS events outside an active Supertonic reading | Cancellation keeps the reader idle |
| LOW | UI polish | `entrypoints/reader.content.ts`, icon masks | Settings used sliders | Official Lucide settings and cloud-download masks | Matches requested icon vocabulary without dependencies |
| HIGH | UX | `entrypoints/reader.content.ts`, `onDocumentClick` | Clicking settings again closed then reopened them; internal settings clicks looked external | Check the host in the document's composed path | A closed shadow root hides its internal row from document listeners |
| HIGH | Writing | `entrypoints/reader.content.ts`, `refreshModelCached`; `entrypoints/background.ts`, `MODEL_CACHE_QUERY` | First-download warning read the page's OPFS instead of the extension cache | Query the extension background; show the note only for a confirmed missing cache | Removes the incorrect pending-download message during ready playback |
| MEDIUM | Layout | `entrypoints/reader.content.ts`, `updateLayout` and `PILL_CSS` | Reader and settings had different widths; expanded title remained behind settings | Matching widths and outer edges during reading; compact idle pill; title/status visually clipped while settings are open and restored on close | Keeps the controls compact without removing live announcements |

## Motion review

| Before | After | Why |
| --- | --- | --- |
| Title transitioned `max-width` and `margin` | Immediate layout change | Removes layout animation from routine reading controls |
| Enter/Space and Escape animated settings | `data-instant` disables keyboard transitions | Keyboard feedback remains immediate |
| Fixed corner origin on scaling settings | 4px vertical slide with opacity, 150ms existing ease-out token | Removes incorrect scaling origin without geometry code |
| Entire loading button rotated | Only the primary loader icon rotates; download icon stays static | Action target stays stable |
| Reduced-motion spinner still moved | Rotation and progress movement guarded by `no-preference` | Status remains available without movement |
| Restoring a card could move a fading popover's anchor | Close immediately when restoring the card; retain the 150ms pointer entrance and keyboard-instant behavior | Avoids an exit jump without animating layout dimensions |

## Verification

- `rtk npm run compile`: passed.
- `rtk npm test`: 192 passed, 0 failed, including Chrome/Firefox extension-cache query routing.
- `rtk npm run build`: Chrome MV3 passed.
- `rtk npm run build:firefox`: Firefox MV2 passed.
- `rtk git diff --check`: passed.
- Temporary harness extracted current production `createPill` and CSS with
  browser/speech mocks; 82/82 DOM checks passed in FR/EN. Covered focus, inert,
  compact loading/download, download before first percentage, progress bounds,
  action names, loading-to-playback title restoration, error and cleanup;
  settings compacting/restoration, actual closed-shadow click lifecycle, accessible
  clipped status/alerts, confirmed/unknown/rejected cache responses, and stale
  responses that must not overwrite newer cache status.
- Temporary regression harness extracted the actual `onTtsEvent`: 19/19
  scenarios passed. Late events after stop or during system playback are
  ignored; active Supertonic loading, progress, errors and completion remain
  delivered, including download telemetry counted once.
- Browser rendering: six positions with settings at 320×640; FR dark and EN
  light states; Enter → engine, Tab through settings, Escape → trigger.
- Long 22-word title at 320×450: reader and settings fit; keyboard focus scrolls
  voice control into view. Initial overflow was reproduced and corrected.
- Requested loading/download update: 272×54 pill at a 320px viewport; pending
  download remains visible. FR dark bottom-right and EN light top-left settings
  fit the viewport. Enter focuses engine; Escape returns to settings.
- Settings update: all six dock positions at 320×640 have matching 272px widths
  and outer edges, with the pending-download note visible. Ready-cache settings
  have matching 336px widths and no note. Pointer second click restores the
  retained title/status; Enter and Escape retain keyboard focus behavior.
- Idle-width clarification: idle pill returns to its intrinsic 138px width;
  settings retain a readable 336px width independently. Reading and paused pills
  keep the shared width, including while settings are open.
- Computed dark status/background: `rgb(131,131,131)` / `rgb(22,22,22)`.
  Light muted text: 5.329:1; dark body text: 14.769:1; white/orange icons:
  3.516:1, passing the 3:1 graphical-object requirement.

Not verified: real Gmail extension runtime/audio, screen-reader announcements,
actual browser 200% zoom (the in-app browser ignored its zoom shortcut), forced
reduced-motion runtime, and slow-motion/frame-by-frame playback. The 320px
viewport and reduced-motion source guards were verified separately.

## Verdict

**Approve** for the inspected interface and motion scope. No confirmed HIGH
finding remains. The production Gmail and assistive-technology checks above
remain explicit verification limits.
