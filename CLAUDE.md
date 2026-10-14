# Fretbored — notes for Claude

Guitar/bass practice web app: Scales, Chords, Arpeggios, Trainer, Circle of Fifths, Metronome, Tuner (tab order).
Live at https://singularity098.github.io/fretbored/ (GitHub Pages, served from `main`).
`Requirements.md` is the owner's feature spec; `README.md` is the public overview.

## Keep this file current

Update CLAUDE.md in the same commit whenever you change something it describes: architecture,
file layout, conventions, settings, commands, deployment, or a lesson learned (especially a
browser quirk). Also keep `Requirements.md` (feature list + decisions) and `README.md` in sync
with user-visible changes — the owner asked for that.

## Hard constraints

- **No dependencies, no build step.** Plain HTML/CSS/JS. No npm packages, CDNs, fonts or network
  requests at runtime.
- **Must work when `index.html` is opened from disk (`file://`).** So scripts are classic
  `<script>` tags (no ES modules — they're blocked on file://), and binary assets are embedded:
  the metronome WAVs live base64-encoded in `js/sounds.js` (regenerate with
  `node tools/embed-sounds.js` after changing `assets/sounds/*.wav`; never edit sounds.js by hand).
  Exception: the tuner's microphone needs https, so it only works on the hosted site.
- Dark theme by default (light via the header toggle); must work on desktop and phones.
- Metronome timing must be sample-accurate (see Audio below).

## Architecture

Everything hangs off one global namespace, `window.FS`. Each file is an IIFE that adds to it.
Script order in `index.html` matters:

| File | Provides |
| --- | --- |
| `js/sounds.js` | `FS.SOUNDS` — generated base64 WAVs |
| `js/theory.js` | `FS.theory` — pitch classes as 12-bit masks, note spelling, scale library (~55, Common/Rare/Exotic), chord library (12 basic + ~25 advanced), `matchScale`, `identifyChord`, `generateVoicings`, `generateArpeggioShapes`, modes |
| `js/tunings.js` | `FS.TUNINGS` presets (MIDI notes, lowest string first; `flats` flag for label spelling), string/fret options |
| `js/store.js` | `FS.settings` (persisted in localStorage key `fretbored:v1`), `FS.save()`, event bus `FS.on/emit`, tuning helpers, `FS.toast`, DOM helper `FS.h(tag, attrs, ...children)` |
| `js/audio.js` | Shared AudioContext (`FS.audio.ctx()`), Karplus–Strong pluck synth (`playNote`, `prepare`), click samples (`loadSamples`, `playSample`, `playBuffer`) |
| `js/fretboard.js` | `FS.Fretboard` SVG component (shared by Scales/Chords/Arpeggios/Trainer), wood + dot themes, horizontal/vertical layout, tap / long-press / right-click handling. Model: `{ notes: [{s, f, kind: 'root'|'note'|'faint', label, iv?, color?}], muted, isActive?(s, f) }` — `color` overrides the theme (dark label), `isActive` shades other cells |
| `js/fbcontrols.js` | Shared fretboard settings bar (inside a collapsible `details.fb-settings`, open state in `fretboard.controlsOpen`, synced across tabs via the `fbcontrols:open` event) + custom tuning editor dialog |
| `js/nowbar.js` | Pinned "now viewing" bar shown while a tab's title is out of view — at the top when scrolled past it, at the bottom while it is still below the screen |
| `js/scales.js`, `chords.js`, `arpeggios.js`, `circle.js`, `trainer.js`, `metronome.js`, `tuner.js` | One `FS.init<Tab>(panel)` per tab. Adding a tab: button + panel in `index.html`, script tag, `TABS` and the init map in `app.js`, defaults in `store.js`, a section in `tests/smoke.browser.js` |
| `js/pitch.js` | `FS.pitch` — McLeod pitch detector with FFT autocorrelation (pure, unit-tested) |
| `js/app.js` | Tabs (`FS.showTab`), theme, startup. Tabs are initialised lazily on first view |
| `css/style.css` | All styles; colours are CSS variables on `:root` / `[data-theme='light']` |

Events: `fretboard` (any fretboard setting or tuning changed → re-render), `tab` (tab switched),
`scales:set` (Circle → Scales hand-off), `fbcontrols:open` (settings section opened/closed).
Tests that use fretboard settings must open `.fb-settings` first (it starts folded).

Layout rule (owner): wherever a fretboard appears, its card (`.board-card`) is the first section of
the tab — each tab does `panel.prepend(panel.querySelector('.board-card'))`.

Settings: add new keys to `DEFAULTS` in `store.js`. `merge()` drops unknown keys and replaces
values whose type doesn't match the default (a default of `null` accepts anything). A nested
object default only keeps the keys it lists, so free-form maps (e.g. `trainer.stats`) must default
to `null` and be initialised in code. To change a default for people who already have the old one
saved, bump a version key and migrate once in `store.js` (see `fretboard.themeVersion`).

The app icon (`assets/icon.svg`) uses the same Circle colours. It is duplicated inline in
`index.html` as the favicon data URI and the header `.logo` SVG — keep all three in sync.

Dot themes live in `FS.DOT_THEMES` (`fretboard.js`). Default is `circle` — the owner asked for the
circle-of-fifths colours (coral root, violet notes, white labels) everywhere a fretboard appears.

### Music-theory conventions

- Pitch classes 0–11 (C=0); sets are 12-bit masks (`bit`, `rotate`, `pcsOf`).
- Spelling goes through `FS.theory.spell(rootPc, intervals, labels)`, which picks the root name
  with the fewest accidentals. Labels like `b3`, `#11` decide letter names. Display text goes
  through `FS.theory.pretty()` (♯/♭).
- Scale and chord interval sets must stay unique (tests enforce this).
- Voicings: root in the bass, contiguous strings, ≤4 fingers or a barre, 4-fret span; scored and
  clustered into positions. Changing the scoring? Re-run the theory tests (they pin the standard
  open shapes x32010, 022100, 320003, x02210, x32310).
- Arpeggio shapes: every chord tone inside a 5-fret box (open box = frets 0–4), each pitch once
  (duplicate pitch keeps the fret nearest the box centre), identical boxes merged, overlapping boxes
  clustered. Tablature is drawn in `arpeggios.js` (SVG, highest string on top, wraps to width).

### Audio — read before touching the metronome

- **Scheduling:** a Web Worker ticks every 25 ms; `schedule()` queues beats whose time is within
  `LOOKAHEAD` (150 ms) of `ctx.currentTime`, using `start(when)` on the audio clock. Visuals follow
  the audio via `getOutputTimestamp()`. After a long stall (> 250 ms) missed beats are skipped
  silently to stay on the grid.
- **One buffer per beat:** each beat's click plus its subdivision clicks are mixed in JS into a
  single cached AudioBuffer and played with one node (`FS.audio.playBuffer`). Do not go back to a
  node per click — see Firefox below.
- The owner tried a 300 ms lookahead and asked for it to be reverted (it delays setting changes).
- Click samples are edge-faded on decode (the classic WAVs are truncated mid-decay and popped).
- `latencyHint: 'playback'` on the AudioContext.

### Browser quirks learned the hard way

- **Firefox for Android** (owner's phone is a OnePlus 11): Web Audio crackles when the page is
  busy, especially right after a setting change — it settles after a while. Brave/Chrome on the
  same phone and Firefox desktop are fine. Mitigations in place: one node per beat, no forced
  reflows per beat (pulse/flash animations alternate between two identical keyframes instead of
  `void el.offsetWidth`), only write text when it changes, and on phones no backdrop-filter, fixed
  backgrounds or animated glows. Some crackle on setting changes remains (owner may revisit).
- **Firefox for Android long-press:** it runs its own long-press gesture and can send
  `pointercancel` mid-press. Long-press therefore tracks touch events too, survives
  `pointercancel`, and only aborts on real movement; `contextmenu` also sets the root. There is
  also a gesture-free "Tap to: Set root" switch on the Scales tab.
- Inline SVGs share one ID space: gradient IDs are per-instance (`fb1wood`, …). A hidden panel
  defining the first copy of an ID breaks the visible one.
- Use `style="stop-color:var(--x)"`, not `stop-color="var(--x)"` attributes.

## Testing

```
node tests/theory.test.js      # spelling, matching, voicings
node tests/pitch.test.js       # tuner pitch-detector accuracy
node tests/smoke.browser.js [screenshot-dir]   # headless Chromium, desktop + phone, every tab
```

- Run all three before pushing; also `node --check js/*.js`.
- The smoke test drives the app from `file://`, fakes the microphone with a generated A2 tone
  (Chrome `--use-file-for-fake-audio-capture`), and checks metronome beat spacing by hooking
  `FS.audio.playBuffer`. Extend it when adding features.
- In cloud sessions Playwright and Chromium are pre-installed (`/opt/node22/lib/node_modules/playwright`,
  `/opt/pw-browsers/chromium`); never run `playwright install`. Only Chromium is available, so
  Firefox-specific bugs can't be reproduced here — say so and ask the owner to verify on device.
- For touch long-press tests use CDP `Input.dispatchTouchEvent`, and scroll the target into view
  first (the fretboard is below the fold on phones).
- Seeding localStorage in a test: wait for the page's debounced save (150 ms) first, and `reload()`
  afterwards — `goto` to the same page with a different `#hash` does not reload it.
- Long timers (the 60-second challenge) are tested with Playwright's fake clock (`page.clock`).
- Look at screenshots after UI changes (phone 390×844 and desktop).

## Workflow and deployment

- Work on the session's assigned branch, then push the same commits to `main` too:
  `git push origin <branch>` and `git push origin <branch>:main`. Pushing to `main` triggers the
  GitHub Pages rebuild (about a minute). The owner approved pushing to `main`.
- Commit messages explain why, not just what.
- The owner tests on a phone; after UI or audio changes tell them what to check and remind them
  to hard-refresh.
