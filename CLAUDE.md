# Fretbored — notes for Claude

Guitar/bass practice web app: Scales, Chords, Arpeggios, Trainer, Circle of Fifths, Tuner, Metronome (tab order).
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
  `<script>` tags (no ES modules — they're blocked on file://), and there are no sound files: every
  sound (notes, reverb, metronome clicks) is generated in code.
  Exception: the tuner's microphone needs https, so it only works on the hosted site.
- Dark theme by default (other app themes from the header palette menu); must work on desktop and phones.
- Metronome timing must be sample-accurate (see Audio below).

## Installable app (PWA)

- `manifest.webmanifest` + `sw.js` (service worker) at the repo root. `app.js` links the manifest and
  registers the worker only on http(s) — on `file://` browsers refuse both (and log errors).
- `sw.js` is stale-while-revalidate: answers from cache, refreshes in the background, so a deploy
  reaches users on their **second** launch. No version number to bump. Its `FILES` list must
  include every script/stylesheet in `index.html` — when adding a JS file, add it there too
  (`tests/pwa.browser.js` fails otherwise).
- Icons: `assets/icon.svg` (any), `assets/icon-maskable.svg` (artwork inside the 80% safe zone),
  PNGs in `assets/icons/` rendered by `node tools/make-icons.js`. Regenerate after icon changes.
- Install button (`#install-app`) shows only when Chrome-family browsers fire `beforeinstallprompt`;
  Firefox/Safari install from their menus (README explains).

## Architecture

Everything hangs off one global namespace, `window.FS`. Each file is an IIFE that adds to it.
Script order in `index.html` matters:

| File | Provides |
| --- | --- |
| `js/theory.js` | `FS.theory` — pitch classes as 12-bit masks, note spelling, scale library (~55, Common/Rare/Exotic), chord library (12 basic + ~25 advanced), `matchScale`, `identifyChord`, `generateVoicings`, `generateArpeggioShapes`, modes |
| `js/tunings.js` | `FS.TUNINGS` presets (MIDI notes, lowest string first; `flats` flag for label spelling), string/fret options |
| `js/store.js` | `FS.settings` (persisted in localStorage key `fretbored:v1` — the only thing the app stores; `FS.exportData()` / `FS.importData(obj)` back it up to / restore it from a JSON file via the header backup menu), `FS.save()`, event bus `FS.on/emit`, tuning helpers, `FS.toast`, DOM helper `FS.h(tag, attrs, ...children)` |
| `js/audio.js` | Shared AudioContext (`FS.audio.ctx()`), Karplus–Strong pluck synth (`playNote(midi, when, dur, gain, {clean}?)`, `prepare`) through one shared guitar chain (`buildChain(ctx, {tone, reverb, delay}, dest)`, rebuilt when `fretboard.tone/reverb/delay` change, old chain freed after 6 s): `buildTone` = highpass → pre-gain → WaveShaper → peaking EQ → cabinet low-pass → level (`FS.TONES`: Clean, Overdriven — Distortion was removed by the owner as too messy; a saved one is reset to Clean in `store.js`), then delay (`FS.DELAYS`, feedback loop with a low-pass) and reverb (`FS.REVERBS`, ConvolverNode with a generated noise impulse) on parallel sends — nothing built while they're off. Palm mute (`fretboard.palmMute`) = a separate damped Karplus–Strong buffer (`makePluck(midi, muted)`, cached per note+mute, ×1.8 gain). `{clean:true}` (tuner) skips all of it. The smoke test renders offline to check tone levels, palm-mute decay, echo timing and reverb tails; metronome clicks (`loadSamples`, `playSample`, `playBuffer`) — see Audio below |
| `js/fretboard.js` | `FS.Fretboard` SVG component (shared by Scales/Chords/Arpeggios/Trainer), woods (`FS.WOODS`), horizontal/vertical layout, tap / long-press / right-click handling. Dot colours come from the app theme, their look from the app style (see below). Model: `{ notes: [{s, f, kind: 'root'|'note'|'faint', label, iv?, color?}], muted, isActive?(s, f), focus?: {lo, hi} }` — `color` overrides the theme (dark label), `isActive` shades other cells, `focus` (Chords/Arpeggios) crops a vertical board to those frets via the SVG viewBox (`cropRange`) unless `fretboard.wholeNeck`; the toggle button is added after the host |
| `js/fbcontrols.js` | Shared "Guitar settings" bar (was "Fretboard settings") (inside a collapsible `details.fb-settings`, open state in `fretboard.controlsOpen`, synced across tabs via the `fbcontrols:open` event) + custom tuning editor dialog |
| `js/nowbar.js` | Pinned "now viewing" bar shown while a tab's title is out of view — at the top when scrolled past it, at the bottom while it is still below the screen |
| `js/scales.js`, `chords.js`, `arpeggios.js`, `circle.js`, `trainer.js`, `metronome.js`, `tuner.js` | One `FS.init<Tab>(panel)` per tab. Adding a tab: button + panel in `index.html`, script tag, `TABS` and the init map in `app.js`, defaults in `store.js`, a section in `tests/smoke.browser.js` |
| `js/pitch.js` | `FS.pitch` — McLeod pitch detector with FFT autocorrelation (pure, unit-tested) |
| `js/app.js` | Tabs (`FS.showTab(tab, from?)`), theme, startup, header pop-up menus (`popupMenu`: colour theme + style picker, backup export/import — import writes storage then reloads), phone swipe between tabs (`setupSwipe`: the panel follows the finger once the move is clearly sideways — a non-passive `touchmove` then cancels page scroll — and on release slides off (past 30% width or a quick flick) or springs back; rubber-band at the first/last tab; ignores gestures starting on sideways-scrolling elements, inputs, dialogs or `[data-noswipe]`). Tabs are initialised lazily on first view |
| `css/style.css` | All styles; colours are CSS variables on `:root` (Dark) and one `:root[data-theme='…']` block per app theme |

Events: `fretboard` (any fretboard setting or tuning changed → re-render), `tab` (tab switched),
`scales:set` (Circle → Scales hand-off), `fbcontrols:open` (settings section opened/closed).
Tests that use fretboard settings must open `.fb-settings` first (it starts folded).

Layout rule (owner): wherever a fretboard appears, its card (`.board-card`) is the first section of
the tab — each tab does `panel.prepend(panel.querySelector('.board-card'))`. Same for the circle of
fifths: the wheel comes first (Key/Mode controls and info sit beside it on desktop, below on phones).

Settings: add new keys to `DEFAULTS` in `store.js`. `merge()` drops unknown keys and replaces
values whose type doesn't match the default (a default of `null` accepts anything). A nested
object default only keeps the keys it lists, so free-form maps (e.g. `trainer.stats`) must default
to `null` and be initialised in code (`trainer.stats` = `{ notes, pos, days, streak }`; each `notes`/`pos`/`days`
record is `[asked, correct, msSum, timedN]` — the last two (answer times of right answers, added later, so may be
missing) drive the speed points, "🐢 slow" flags and the slow-note weighting of "Focus on weak spots"; `streak` =
`{ count, last, best }` for the 50-notes-a-day streak, rebuilt from `days` by `initStreak` when missing). To change a default for people who already have the old one
saved, bump a version key and migrate once in `store.js` (see `trainer.version`).

The app icon (`assets/icon.svg`, owner's pick from a set of mock-ups) is a fretboard tile whose note
dots spell an F — violet dots, coral root dot top-left (the Dark theme's dot colours). It is duplicated
inline in `index.html` as the favicon data URI and the header `.logo` SVG, and as
`assets/icon-maskable.svg` (same artwork scaled 0.78 into the safe zone) + the PNGs in `assets/icons/` —
keep them all in sync. The header name is the `.wordmark` SVG: "Fret" + "bored" set in Audiowide (SIL OFL)
and converted to two paths (`.wm-fret` → `--text`, `.wm-bored` → `--accent-2`) because the app can't
load fonts; `tools/make-wordmark.py` regenerates the paths (dev-time only, needs fontTools + the TTF).

App colour themes: `THEMES` in `app.js` (id, name, swatch colours; the first swatch colour is the
browser `theme-color`) + a `:root[data-theme='id']` block of variables in `style.css`. Each theme sets its own
`--accent`/`--accent-2` pair (active buttons, pills, tabs) and `--on-accent` (text on them — dark for
light accents like cyan or yellow). Named themes (Dracula, Solarized, Tokyo Night, Catppuccin) use their official
palettes; Catppuccin maps mantle → `--bg`, base → `--surface`, surface0/1 → `--surface-2/3`. Adding one
needs both, plus the smoke test's theme list. Keep the palette selectors scoped to `:root` — an
unscoped `[data-theme='light']` also matched a menu button carrying that attribute.

Note dot colours belong to the app theme: `--dot-root`, `--dot-note` and their label colours
`--dot-root-ink` / `--dot-note-ink` in each `:root[data-theme]` block (the fretboard and the chord
diagram use them via `style="fill:var(--…)"`). The owner removed the separate dot-colour picker.
Dark keeps the circle-of-fifths colours (coral root, violet notes, white labels); each other theme
has its own pair from its palette — keep pairs distinct between themes and root vs notes clearly
different. A note's `color` (trainer feedback) still overrides the theme.

App styles (owner asked for them): Ring (**default** — owner's pick, listed first), Classic (the original look)
and Target (id `halo`). Glass, Flat, Pixel, Sticker, Pearl and Neon were tried and removed by the owner; a saved
removed style falls back to Ring (`applyStyle`), and `styleVersion` moved everyone to Ring once (`store.js`).
`STYLES` in `app.js` (`settings.style`, `<html data-style>`), picked in the "Style" column of the palette menu (the menu has a
"Colours" column and a "Style" column — stacked and scrollable on phones; each style item has a drawn
preview, `stylePreview`). Style is independent of the colour theme: a style only changes shapes,
fills, rings, glows and shadows, and takes every colour from the theme. Classic has no rules; each other
style is a `:root[data-style='id']` block at the end of `style.css` covering note dots (fretboard + chord
diagram `.cb-dot`, which carries `--dot`), active tabs, pills, primary buttons, segmented buttons,
switches and metronome beat lights. Ring/Target use `--ring-fill` (a fixed near-black) for dots.
In `fretboard.js` every non-faint note gets a `.halo` ring (shown only on the root, or on all notes in
Target, which also shrinks the dot to 0.78 r so rings on neighbouring strings don't touch). A style
change emits `fretboard` to redraw. Theme-colour tests read the dot's `stroke` (Ring's fill is dark).
Ring and Target borrow Classic's accent gradient for active buttons/tabs/pills: a gradient ring drawn by a masked
`::after` (`--ring-w`; Target's is the page-coloured gap between its two rings) — box-shadows can't be gradients.
Adding a style: `STYLES` + `stylePreview` case + CSS block + the smoke test's style list.

### Music-theory conventions

- Pitch classes 0–11 (C=0); sets are 12-bit masks (`bit`, `rotate`, `pcsOf`).
- Spelling goes through `FS.theory.spell(rootPc, intervals, labels)`, which picks the root name
  with the fewest accidentals. Labels like `b3`, `#11` decide letter names. Display text goes
  through `FS.theory.pretty()` (♯/♭).
- Scale and chord interval sets must stay unique (tests enforce this).
- Voicings: root in the bass, contiguous strings, ≤4 fingers or a barre, 4-fret span; scored and
  clustered into positions. Changing the scoring? Re-run the theory tests (they pin the standard
  open shapes x32010, 022100, 320003, x02210, x32310).
- Arpeggio positions (`generateArpeggioShapes`): CAGED — a 5-fret window anchored on each root
  (E [R-1,R+3] and G [R-4,R] on the 6th string, A [R,R+4] and C [R-3,R+1] on the 5th, D [R-1,R+3]
  on the 4th; strings counted from the top six so 7/8-strings work), filled by `boxNotes` (every chord
  tone once; duplicates keep the fret nearest the centre, ties to the lower fret). Names only when
  `isStandardLike`. Sliding boxes are the fallback. Theory tests pin standard charts (open E/C, A shape
  at 7, Am E shape at 5) — re-run them after changing windows.
- Sweep shapes (`generateSweepShapes`): DFS up the chord tones string by string, ≤2 notes per string,
  ≤6-fret span, ≤5-fret stretch on one string; root sweeps from strings with ≥3 above end on a root,
  3-string sweeps end on the start tone an octave up. Scoring avoids doubles on middle strings (and on
  the first string for 3-string). Tests pin the owner's E major 5-string (A 7·11, 9 9 9, e 7·12).
- Arpeggios tab editing: `arpeggios.custom` = `[[string, fret], …]` (null = generated shape); `currentShape()` returns it as a shape (`kind: 'custom'`), `identify(preferRoot?)` names it with `identifyChord` (lowest note as bass), long-press = `rootNote`. Root/type/style/position clear it; a tuning change drops it (like Chords).
- Tablature is drawn in `arpeggios.js` (SVG, highest string on top, wraps to width).

### Audio — read before touching the metronome

- **Scheduling:** a Web Worker ticks every 25 ms; `schedule()` queues beats whose time is within
  `LOOKAHEAD` (150 ms) of `ctx.currentTime`, using `start(when)` on the audio clock. Visuals follow
  the audio via `getOutputTimestamp()`. After a long stall (> 250 ms) missed beats are skipped
  silently to stay on the grid.
- **One buffer per beat:** each beat's click plus its subdivision clicks are mixed in JS into a
  single cached AudioBuffer and played with one node (`FS.audio.playBuffer`). Do not go back to a
  node per click — see Firefox below.
- The owner tried a 300 ms lookahead and asked for it to be reverted (it delays setting changes).
- Click sounds are generated in `audio.js` (`classicClick`, `digitalClick`, `beep`) with the exact formulas of
  the NAMsayin plugin's metronome (`src/engine/metronome/Metronome.cpp` in singularity098/namsayin), so the
  two sound identical (verified bit-for-bit against the compiled C++ at 44.1 kHz). Classic was fitted from the
  WAVs the app used to embed (zero residual); Digital replaced its WAV with NAMsayin's band-limited square.
  Change a sound in both projects, or they drift apart. Gains (`LEVEL_GAIN`, subdivisions × 0.75) match too.
- `latencyHint: 'playback'` on the AudioContext.
- Visual sync (`metronome.syncMs`, −100…+300 ms): `draw()` uses `audibleNow() - syncMs`, so only the
  visuals shift. The earliest setting is bounded by `LOOKAHEAD` — beats must already be queued to be
  drawn early. The smoke test measures the light-vs-audio lag at 0 and +200 ms.
- Tempo display: queued beats carry the tempo they were scheduled at, which can be behind a ± tap.
  `draw()` only shows a beat's tempo while the tempo trainer is on (it changes tempo itself); otherwise
  the display shows `m.bpm`, or the old tempo would flash back for a beat or two.

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
- Horizontal swipes can trigger the browser's history back/forward gesture (seen in headless Chromium,
  which left the page mid-test); `html { overscroll-behavior-x: none }` stops it.

## Testing

```
node tests/theory.test.js      # spelling, matching, voicings
node tests/pitch.test.js       # tuner pitch-detector accuracy
node tests/smoke.browser.js [screenshot-dir]   # headless Chromium, desktop + phone, every tab
node tests/pwa.browser.js      # installable app: installability, precache list, offline, updates
```

- Run all four before pushing; also `node --check js/*.js sw.js`.
- The PWA test needs a non-incognito profile (`launchPersistentContext`) — Chrome reports
  `in-incognito` and never allows installs in Playwright's default context.
- The smoke test drives the app from `file://`, fakes the microphone with a generated A2 tone
  (Chrome `--use-file-for-fake-audio-capture`), and checks metronome beat spacing by hooking
  `FS.audio.playBuffer`. Extend it when adding features.
- In cloud sessions Playwright and Chromium are pre-installed (`/opt/node22/lib/node_modules/playwright`,
  `/opt/pw-browsers/chromium`); never run `playwright install`. Only Chromium is available, so
  Firefox-specific bugs can't be reproduced here — say so and ask the owner to verify on device.
- For touch long-press and swipe tests use CDP `Input.dispatchTouchEvent`, and scroll the target into view
  first (the fretboard is below the fold on phones).
- `FS.save()` batches writes (150 ms) but also flushes a pending save on `visibilitychange`→hidden and
  `pagehide` — phones freeze backgrounded pages and drop pending timers (lost the arpeggio speed).
  `FS.importData` clears the pending save so the reload's flush can't overwrite an import.
- Seeding localStorage in a test: wait for the page's debounced save (150 ms) first, and `reload()`
  afterwards — `goto` to the same page with a different `#hash` does not reload it.
- Long timers (the 60-second challenge) are tested with Playwright's fake clock (`page.clock`).
- Look at screenshots after UI changes (phone 390×844 and desktop).
- README screenshots live in `docs/screenshots/` and come from `node tools/screenshots.js [tab ...]`
  (default settings from a cleared localStorage; desktop 1280×860 every tab, phone 390×844 @2x with the
  vertical board for Scales/Chords/Arpeggios/Metronome). Re-run it after visible UI changes and look at
  the results before committing.

## Workflow and deployment

- Work on the session's assigned branch, then push the same commits to `main` too:
  `git push origin <branch>` and `git push origin <branch>:main`. Pushing to `main` triggers the
  GitHub Pages rebuild (about a minute). The owner approved pushing to `main`.
- Commit messages explain why, not just what.
- The owner tests on a phone; after UI or audio changes tell them what to check and remind them
  to hard-refresh.
