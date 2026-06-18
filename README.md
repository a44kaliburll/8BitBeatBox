# 8BitBeatBox

A comprehensive **NES / SNES-era chiptune maker** in the spirit of BeepBox and
Bosca Ceoil — but every sound is synthesized to match the real 8-bit/16-bit
console sound chips.

## Run it

Two ways:

**1 · Desktop app (Windows).** Download the latest installer from the
[Releases page](https://github.com/a44kaliburll/8BitBeatBox/releases), run
`8BitBeatBox Setup x.y.z.exe`, and launch it from the Start menu / desktop
shortcut. A `…-portable.exe` (no install) is also published.

**2 · In a browser.** Just double-click `index.html` — it runs in any modern
browser (Chrome/Edge give the best Web Audio performance). Audio starts on your
first click/Play (browsers require a user gesture before playing sound).

### Building the installer yourself
```bash
npm install
npm run dist          # → dist/8BitBeatBox Setup x.y.z.exe  (+ portable .exe)
```
The app is wrapped with [Electron](https://www.electronjs.org/) and packaged by
[electron-builder](https://www.electron.build/) (NSIS installer). Pushing a
`vX.Y.Z` git tag also builds the installer in CI and attaches it to a Release.

## The sound engine (authentic chip emulation)

The synth recreates the **NES APU (2A03)** voice types plus a roster of
SNES-style timbres — **35 instruments** in three groups:

| Group | Instruments |
|-------|-------------|
| **NES** | Pulse 12.5% / 25% / 50%, Pulse Lead, Pulse Pluck, Pulse Soft, PWM Lead, Square Stab, Chip Organ, Triangle Bass, Triangle Lead, Triangle Pluck, Octave Bass |
| **Drums / FX** | Kick, Tom, Snare, Closed Hat, Open Hat, Clap, Crash, Metal Noise, Laser FX |
| **SNES-style** | Saw Lead, Fat Saw, Super Saw, Strings, Brass, Flute, Soft Bell, Glass Bell, Electric Piano, Marimba, Organ, Choir, Warm Pad |

Richer voices are built from stacked, detuned and octave-doubled oscillators;
the Kick/Tom use pitch-drop sweeps and the Laser FX a glide.

- **Pulse waves** are built from true Fourier coefficients for each duty cycle —
  12.5%/25% give the classic "thin" NES lead; 50% is the full square.
- **Triangle** is the NES bass voice (odd-harmonic, 1/n² rolloff).
- **Noise** uses both white noise and a short repeating LFSR pattern for the
  metallic/periodic NES noise mode; pitch shifts it between hats and snares.
- Each instrument has its own ADSR envelope and optional vibrato.

## How to use

**Channels (left panel)**
- Click a channel to make it the **active** editing track (its notes show bright
  in the roll; other channels are dimmed).
- Pick its **instrument**, set **volume**, **M**ute or **S**olo it, rename it,
  or delete it. Add up to 8 channels.

**Piano roll (center)**
- **Click _or drag_** across the grid to **paint** notes — drag diagonally to lay
  down rolling scales, runs and arpeggios. New notes use the **Note** length
  (1/16 … whole) and snap to the **Key + Scale** when **Snap** is on.
- **Drag the right edge** of a note to change its length.
- **Drag the body** to move it (pitch + time).
- **Right-drag** or **Alt-click** to erase.
- **Click a piano key** in the left gutter to audition a pitch.
- A glowing **playhead** sweeps as the song plays (and auto-follows).

**Patterns & arrangement**
- Make multiple **Patterns** (＋ new, ⧉ duplicate, ⌫ clear, ✕ delete).
  Double-click a pattern chip to rename it.
- Build a full song in the **Song Arrangement** bar by ordering patterns, then
  set **Mode → Play Song**.

**Transport & global**
- **Play / Stop** (or press **Spacebar**), **BPM**, master **Vol**.
- **Grid** (note resolution), **Beats** per bar, **Bars** per pattern, **Zoom**.
- **Undo / Redo** (↶ ↷ or **Ctrl+Z / Ctrl+Y**).

**Songs browser** (the **☰ Songs** button)
- **Demo Songs** — five ready-made tracks to load and learn from: *Neon Quest*,
  *Castle Halls*, *Bubble Pop*, *Boss Rush*, *Sky Overworld*. (*Neon Quest* also
  loads on first launch.)
- **My Saved Songs** — the **Save** button stores the current song in your
  in-browser library (keyed by title, so re-saving updates it). Reload, rename,
  export, or delete any save from here.
- **Blank Song** to start empty, or **Import .json** to open a shared file.
- **🎹 Convert a MIDI** — drop in any `.mid` and it becomes an editable chiptune:
  tempo/time-signature are read from the file, each track/channel is auto-mapped
  to an NES/SNES instrument (bass→triangle, drums→kick + noise, etc.), and notes
  are quantised to the grid. This is the "turn any song into an 8-bit song" path.

### Making a recording sound 8-bit (WAV / MP3)
Two different things you might want:

**A) Crush the recording → the 🎛 8-Bit FX button.** Load any WAV/MP3 and degrade
it to retro-console character — bit-depth reduction, sample-rate decimation, a
warm low-pass, soft drive and optional SNES-style reverb. Presets for **SNES
(16-bit)**, **NES (8-bit)**, **Game Boy (4-bit)** and **Lo-Fi**, plus fine-tune
sliders. Preview, then **Export WAV**. Your whole song stays intact — it just
sounds like it's playing on old hardware (it is *not* re-played on chips).

**B) Re-create it as a true chiptune → Convert a MIDI.** A recording has no note
data, so first convert the audio to MIDI with a free audio-to-MIDI tool — e.g.
[Spotify basic-pitch](https://basicpitch.spotify.com/) — then use **Convert a
MIDI**. Clean monophonic melodies transcribe best; busy mixes need editing. The
original DAW project's MIDI gives the best result.

**Files**
- **Export WAV** renders the song (current pattern, or the whole arrangement in
  Song mode) to a 16-bit WAV.
- Songs save into the in-browser library (above); use **Import / Export .json**
  in the Songs browser to share song files between machines.
- Your in-progress work also **autosaves** to the browser between sessions.

## Project layout

```
index.html          markup + control IDs
css/style.css        neon retro UI
css/fonts.css        bundled fonts (Press Start 2P, VT323) — fully offline
css/fonts/           the .ttf files
js/synth.js          NES/SNES synthesis + 35-instrument palette
js/song.js           data model (song, channels, patterns, scales)
js/library.js        in-browser saved-song library (localStorage)
js/midi.js           Standard MIDI File parser + .mid → chiptune converter
js/crusher.js        8-bit/16-bit audio FX (bitcrush WAV/MP3, presets, export)
js/demo.js           the five built-in demo songs
js/sequencer.js      lookahead playback scheduler + clock playhead + WAV export
js/pianoroll.js      canvas piano-roll editor (offscreen layer + paint mode)
js/ui.js             channel rack / pattern / arrangement UI
js/main.js           app state, transport, undo/redo, settings, file I/O
```
