# Fretbored

Guitar scales, chords, circle of fifths and a precise metronome — in the browser, with no dependencies.

- **Scales**: any key, ~55 scales across Common / Rare / Exotic. Click frets to add or remove notes and Fretbored works out which scale you've made; right-click or long-press to change the root.
- **Chords**: 12 core chord types plus ~25 advanced ones, generated as playable voicings for your tuning in several positions up the neck. Edit the shape and the chord is re-identified (including slash chords).
- **Circle of Fifths**: pick a key and mode to see diatonic chords with Roman numerals, key signature and related keys.
- **Tuner**: traditional needle and strobe modes, instrument (per-string, using your tuning) or chromatic, adjustable A4 reference and reference tones.
- **Metronome**: tap tempo, accents, odd-meter grouping, subdivisions, step and gradual tempo trainer, gap trainer. Sample-accurate Web Audio scheduling.
- Shared fretboard settings: 4–8 strings (guitar and bass), preset and custom tunings, 21/22/24 frets, note or interval labels, dot color themes, ebony/rosewood/maple, left-handed mode, and a sideways or vertical layout on phones.

## Running it

Open `index.html` in a browser — that's it. It works offline from disk; everything (including the metronome sounds) is bundled.

To serve it locally instead: `npx http-server .` (or any static server).

## Hosting on GitHub Pages

The site is static, so GitHub Pages can serve it straight from the repository:

1. Repository **Settings → Pages**.
2. Under **Build and deployment**, choose **Deploy from a branch**, pick the branch (e.g. `main`) and the `/ (root)` folder, then **Save**.
3. After a minute the site is live at `https://<user>.github.io/fretbored/`.

Live site: **https://singularity098.github.io/fretbored/**

(The `.nojekyll` file tells Pages to serve the files as-is.)

## Development

- No build step. Scripts are plain (non-module) JavaScript so the page works from `file://`.
- `node tests/theory.test.js` — tests for spelling, scale/chord matching and voicing generation.
- `node tests/pitch.test.js` — pitch detector accuracy tests.
- `node tests/smoke.browser.js` — headless-Chromium smoke test of every tab (desktop + phone); needs Playwright.
- `CLAUDE.md` — architecture, conventions and hard-won browser notes for AI-assisted development.
- `node tools/embed-sounds.js` — regenerates `js/sounds.js` after changing files in `assets/sounds/`.

| File | Purpose |
| --- | --- |
| `js/theory.js` | Note spelling, scale & chord library, matching, voicing generator |
| `js/tunings.js` | Preset tunings |
| `js/store.js` | Settings persistence, events, helpers |
| `js/audio.js` | Web Audio context, plucked-string synth, sample playback |
| `js/fretboard.js` | Shared SVG fretboard |
| `js/fbcontrols.js` | Fretboard settings bar and custom tuning editor |
| `js/pitch.js` | Pitch detection (McLeod pitch method) |
| `js/scales.js`, `js/chords.js`, `js/circle.js`, `js/metronome.js`, `js/tuner.js` | The tabs |
| `js/app.js` | Tabs, theme, startup |

See [Requirements.md](Requirements.md) for the full feature list.
