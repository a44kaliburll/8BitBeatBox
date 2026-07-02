/* ============================================================================
 * 8BitBeatBox — synth.js
 * Authentic NES (2A03 APU) + SNES-style synthesis engine built on Web Audio.
 *
 * Context-agnostic: every voice is built by createVoice(ctx, ...) so the same
 * code path serves live playback (AudioContext) and offline WAV rendering
 * (OfflineAudioContext).
 *
 * Instruments are data-driven. A tonal instrument may define a `stack` of
 * oscillators (ratio/detune/gain) to build fuller, detuned or octave-doubled
 * timbres, and an optional `sweep` for pitch glides (lasers, zaps).
 * ========================================================================== */
(function (global) {
  'use strict';

  function midiToFreq(m) { return 440 * Math.pow(2, (m - 69) / 12); }

  // ---- Wavetable builders (band-limited PeriodicWaves) ---------------------
  function pulseWave(ctx, duty, n) {
    var real = new Float32Array(n + 1), imag = new Float32Array(n + 1);
    for (var i = 1; i <= n; i++) {
      real[i] = 2 * Math.sin(2 * Math.PI * i * duty) / (Math.PI * i);
      imag[i] = 2 * (1 - Math.cos(2 * Math.PI * i * duty)) / (Math.PI * i);
    }
    return ctx.createPeriodicWave(real, imag, { disableNormalization: false });
  }
  function triangleWave(ctx, n) {
    var real = new Float32Array(n + 1), imag = new Float32Array(n + 1);
    for (var i = 1; i <= n; i += 2) {
      var sign = (((i - 1) / 2) % 2 === 0) ? 1 : -1;
      imag[i] = sign * (8 / (Math.PI * Math.PI)) / (i * i);
    }
    return ctx.createPeriodicWave(real, imag, { disableNormalization: false });
  }
  function sawWave(ctx, n) {
    var real = new Float32Array(n + 1), imag = new Float32Array(n + 1);
    for (var i = 1; i <= n; i++) imag[i] = (2 / (Math.PI * i)) * ((i % 2 === 1) ? 1 : -1);
    return ctx.createPeriodicWave(real, imag, { disableNormalization: false });
  }

  // ---- Per-context asset cache --------------------------------------------
  var assetCache = new WeakMap();
  var HARMONICS = 1024;

  function buildNoiseBuffer(ctx, periodSamples) {
    var rate = ctx.sampleRate, len = Math.floor(rate * 2);
    var buf = ctx.createBuffer(1, len, rate), data = buf.getChannelData(0);
    if (periodSamples > 0) {
      var pat = new Float32Array(periodSamples);
      for (var p = 0; p < periodSamples; p++) pat[p] = Math.random() * 2 - 1;
      for (var i = 0; i < len; i++) data[i] = pat[i % periodSamples];
    } else {
      for (var j = 0; j < len; j++) data[j] = Math.random() * 2 - 1;
    }
    return buf;
  }

  function getAssets(ctx) {
    var a = assetCache.get(ctx);
    if (a) return a;
    a = {
      waves: {
        pulse125: pulseWave(ctx, 0.125, HARMONICS),
        pulse25: pulseWave(ctx, 0.25, HARMONICS),
        pulse50: pulseWave(ctx, 0.5, HARMONICS),
        triangle: triangleWave(ctx, HARMONICS),
        saw: sawWave(ctx, HARMONICS)
      },
      noiseWhite: buildNoiseBuffer(ctx, 0),
      noiseMetal: buildNoiseBuffer(ctx, 93)
    };
    assetCache.set(ctx, a);
    return a;
  }

  // ---- Instrument palette --------------------------------------------------
  // env: ADSR seconds (s = sustain 0..1). vib: vibrato. stack: extra oscillators.
  var INSTRUMENTS = [
    // ===== NES tonal =====
    { id: 'pulse125', name: 'Pulse 12.5%', group: 'NES', type: 'pulse', wave: 'pulse125', gain: 0.24, env: { a: 0.005, d: 0.04, s: 0.85, r: 0.06 } },
    { id: 'pulse25', name: 'Pulse 25%', group: 'NES', type: 'pulse', wave: 'pulse25', gain: 0.24, env: { a: 0.005, d: 0.05, s: 0.8, r: 0.07 } },
    { id: 'pulse50', name: 'Square 50%', group: 'NES', type: 'pulse', wave: 'pulse50', gain: 0.2, env: { a: 0.005, d: 0.05, s: 0.85, r: 0.07 } },
    { id: 'pulseLead', name: 'Pulse Lead', group: 'NES', type: 'pulse', wave: 'pulse25', gain: 0.22, env: { a: 0.01, d: 0.06, s: 0.8, r: 0.1 }, vib: { depth: 14, speed: 6, delay: 0.12 } },
    { id: 'pulsePluck', name: 'Pulse Pluck', group: 'NES', type: 'pulse', wave: 'pulse25', gain: 0.26, env: { a: 0.002, d: 0.1, s: 0.0, r: 0.05 } },
    { id: 'pulseSoft', name: 'Pulse Soft', group: 'NES', type: 'pulse', wave: 'pulse125', gain: 0.22, env: { a: 0.06, d: 0.1, s: 0.7, r: 0.14 } },
    { id: 'pwmLead', name: 'PWM Lead', group: 'NES', type: 'pulse', wave: 'pulse25', gain: 0.16, env: { a: 0.01, d: 0.08, s: 0.8, r: 0.12 }, vib: { depth: 8, speed: 5, delay: 0.15 },
      stack: [{ wave: 'pulse25', detune: -7, gain: 1 }, { wave: 'pulse125', detune: 8, gain: 0.8 }] },
    { id: 'squareStab', name: 'Square Stab', group: 'NES', type: 'pulse', wave: 'pulse50', gain: 0.24, env: { a: 0.002, d: 0.08, s: 0.0, r: 0.04 } },
    { id: 'nesOrgan', name: 'Chip Organ', group: 'NES', type: 'pulse', wave: 'pulse50', gain: 0.13, env: { a: 0.01, d: 0.04, s: 0.95, r: 0.08 },
      stack: [{ wave: 'pulse50', ratio: 1, gain: 0.9 }, { wave: 'pulse25', ratio: 2, gain: 0.45 }, { wave: 'pulse50', ratio: 1.5, gain: 0.35 }] },
    { id: 'triBass', name: 'Triangle Bass', group: 'NES', type: 'triangle', wave: 'triangle', gain: 0.34, env: { a: 0.004, d: 0.04, s: 0.95, r: 0.06 } },
    { id: 'triLead', name: 'Triangle Lead', group: 'NES', type: 'triangle', wave: 'triangle', gain: 0.3, env: { a: 0.01, d: 0.08, s: 0.7, r: 0.12 }, vib: { depth: 8, speed: 5.5, delay: 0.1 } },
    { id: 'triPluck', name: 'Triangle Pluck', group: 'NES', type: 'triangle', wave: 'triangle', gain: 0.34, env: { a: 0.003, d: 0.16, s: 0.0, r: 0.06 } },
    { id: 'octaveBass', name: 'Octave Bass', group: 'NES', type: 'triangle', wave: 'triangle', gain: 0.3, env: { a: 0.004, d: 0.05, s: 0.9, r: 0.06 },
      stack: [{ wave: 'triangle', ratio: 1, gain: 1 }, { wave: 'triangle', ratio: 2, gain: 0.4 }] },

    // ===== Drums / FX =====
    { id: 'kick', name: 'Kick', group: 'Drums', type: 'kick', gain: 0.5, env: { a: 0.001, d: 0.16, s: 0.0, r: 0.04 }, drop: { from: 2.2, to: 0.6, time: 0.09 } },
    { id: 'tom', name: 'Tom', group: 'Drums', type: 'kick', gain: 0.42, env: { a: 0.001, d: 0.18, s: 0.0, r: 0.05 }, drop: { from: 1.6, to: 0.85, time: 0.13 } },
    { id: 'noiseSnare', name: 'Snare', group: 'Drums', type: 'noise', noise: 'white', gain: 0.22, basePitch: 52, env: { a: 0.001, d: 0.12, s: 0.0, r: 0.06 } },
    { id: 'noiseHat', name: 'Closed Hat', group: 'Drums', type: 'noise', noise: 'white', gain: 0.16, basePitch: 64, env: { a: 0.001, d: 0.04, s: 0.0, r: 0.03 } },
    { id: 'openHat', name: 'Open Hat', group: 'Drums', type: 'noise', noise: 'white', gain: 0.14, basePitch: 66, env: { a: 0.001, d: 0.22, s: 0.0, r: 0.14 } },
    { id: 'clap', name: 'Clap', group: 'Drums', type: 'noise', noise: 'white', gain: 0.2, basePitch: 57, env: { a: 0.001, d: 0.06, s: 0.0, r: 0.05 } },
    { id: 'crash', name: 'Crash', group: 'Drums', type: 'noise', noise: 'white', gain: 0.13, basePitch: 60, env: { a: 0.001, d: 0.6, s: 0.0, r: 0.4 } },
    { id: 'noiseMetal', name: 'Metal Noise', group: 'Drums', type: 'noise', noise: 'metal', gain: 0.18, basePitch: 60, env: { a: 0.001, d: 0.1, s: 0.05, r: 0.06 } },
    { id: 'ride', name: 'Ride', group: 'Drums', type: 'noise', noise: 'metal', gain: 0.12, basePitch: 72, env: { a: 0.001, d: 0.5, s: 0.0, r: 0.3 } },
    { id: 'shaker', name: 'Shaker', group: 'Drums', type: 'noise', noise: 'white', gain: 0.12, basePitch: 78, env: { a: 0.01, d: 0.05, s: 0.0, r: 0.04 } },
    { id: 'laser', name: 'Laser FX', group: 'Drums', type: 'pulse', wave: 'pulse25', gain: 0.2, env: { a: 0.001, d: 0.3, s: 0.0, r: 0.05 }, sweep: { from: 3, to: 0.5, time: 0.28 } },

    // ===== SNES-style =====
    { id: 'sawLead', name: 'Saw Lead', group: 'SNES', type: 'wave', wave: 'saw', gain: 0.16, env: { a: 0.008, d: 0.1, s: 0.7, r: 0.12 }, vib: { depth: 10, speed: 5.5, delay: 0.15 } },
    { id: 'fatSaw', name: 'Fat Saw', group: 'SNES', type: 'wave', wave: 'saw', gain: 0.12, env: { a: 0.01, d: 0.12, s: 0.75, r: 0.16 },
      stack: [{ wave: 'saw', detune: -9, gain: 0.85 }, { wave: 'saw', detune: 9, gain: 0.85 }] },
    { id: 'superSaw', name: 'Super Saw', group: 'SNES', type: 'wave', wave: 'saw', gain: 0.09, env: { a: 0.02, d: 0.15, s: 0.8, r: 0.2 },
      stack: [{ wave: 'saw', detune: -14, gain: 0.7 }, { wave: 'saw', detune: 0, gain: 0.8 }, { wave: 'saw', detune: 14, gain: 0.7 }] },
    { id: 'strings', name: 'Strings', group: 'SNES', type: 'wave', wave: 'saw', gain: 0.12, env: { a: 0.12, d: 0.2, s: 0.8, r: 0.3 }, vib: { depth: 7, speed: 5, delay: 0.2 },
      stack: [{ wave: 'saw', detune: -6, gain: 0.8 }, { wave: 'saw', detune: 6, gain: 0.8 }] },
    { id: 'brass', name: 'Brass', group: 'SNES', type: 'wave', wave: 'saw', gain: 0.13, env: { a: 0.05, d: 0.12, s: 0.85, r: 0.14 }, vib: { depth: 6, speed: 5, delay: 0.2 } },
    { id: 'flute', name: 'Flute', group: 'SNES', type: 'triangle', wave: 'triangle', gain: 0.26, env: { a: 0.06, d: 0.1, s: 0.85, r: 0.16 }, vib: { depth: 9, speed: 5.5, delay: 0.18 } },
    { id: 'bell', name: 'Soft Bell', group: 'SNES', type: 'sine', gain: 0.26, env: { a: 0.002, d: 0.5, s: 0.0, r: 0.4 } },
    { id: 'glass', name: 'Glass Bell', group: 'SNES', type: 'sine', gain: 0.2, env: { a: 0.002, d: 0.6, s: 0.0, r: 0.5 },
      stack: [{ wave: 'sine', ratio: 1, gain: 1 }, { wave: 'sine', ratio: 2, gain: 0.4 }, { wave: 'sine', ratio: 3.01, gain: 0.18 }] },
    { id: 'ePiano', name: 'Electric Piano', group: 'SNES', type: 'sine', gain: 0.22, env: { a: 0.003, d: 0.35, s: 0.25, r: 0.2 },
      stack: [{ wave: 'sine', ratio: 1, gain: 1 }, { wave: 'sine', ratio: 2, detune: 6, gain: 0.35 }] },
    { id: 'marimba', name: 'Marimba', group: 'SNES', type: 'sine', gain: 0.26, env: { a: 0.002, d: 0.22, s: 0.0, r: 0.08 },
      stack: [{ wave: 'sine', ratio: 1, gain: 1 }, { wave: 'sine', ratio: 4, gain: 0.25 }] },
    { id: 'organ', name: 'Organ', group: 'SNES', type: 'pulse', wave: 'pulse50', gain: 0.13, env: { a: 0.01, d: 0.04, s: 0.95, r: 0.08 },
      stack: [{ wave: 'pulse50', ratio: 1, gain: 0.9 }, { wave: 'pulse50', ratio: 2, gain: 0.5 }, { wave: 'pulse50', ratio: 3, gain: 0.3 }] },
    { id: 'choir', name: 'Choir', group: 'SNES', type: 'wave', wave: 'saw', gain: 0.12, env: { a: 0.18, d: 0.25, s: 0.85, r: 0.4 }, vib: { depth: 6, speed: 4.5, delay: 0.3 },
      stack: [{ wave: 'saw', detune: -5, gain: 0.6 }, { wave: 'triangle', detune: 5, gain: 0.7 }] },
    { id: 'pad', name: 'Warm Pad', group: 'SNES', type: 'wave', wave: 'triangle', gain: 0.14, env: { a: 0.2, d: 0.3, s: 0.85, r: 0.5 }, vib: { depth: 5, speed: 4, delay: 0.3 },
      stack: [{ wave: 'triangle', detune: -6, gain: 0.8 }, { wave: 'saw', detune: 6, gain: 0.35 }] },

    // ===== PS1 / 32-bit (FM bells, filtered digital leads, acid & sub bass) =====
    { id: 'fmBell', name: 'FM Bell', group: 'PS1', type: 'sine', gain: 0.24, env: { a: 0.002, d: 0.7, s: 0.0, r: 0.5 },
      stack: [{ wave: 'sine', ratio: 1, gain: 1 }, { wave: 'sine', ratio: 3.5, gain: 0.28 }, { wave: 'sine', ratio: 7.02, gain: 0.1 }] },
    { id: 'fmEPiano', name: 'FM E-Piano', group: 'PS1', type: 'sine', gain: 0.22, env: { a: 0.003, d: 0.45, s: 0.2, r: 0.25 },
      stack: [{ wave: 'sine', ratio: 1, gain: 1 }, { wave: 'sine', ratio: 2, detune: 5, gain: 0.3 }, { wave: 'sine', ratio: 6.98, gain: 0.08 }] },
    { id: 'digiLead', name: 'Digital Lead', group: 'PS1', type: 'wave', wave: 'saw', gain: 0.15, env: { a: 0.006, d: 0.09, s: 0.75, r: 0.12 }, vib: { depth: 9, speed: 5.5, delay: 0.14 },
      filter: { freq: 2400, q: 1.2, env: 3200, decay: 0.16 },
      stack: [{ wave: 'saw', detune: -6, gain: 0.9 }, { wave: 'pulse25', detune: 7, gain: 0.65 }] },
    { id: 'resoPluck', name: 'Reso Pluck', group: 'PS1', type: 'wave', wave: 'saw', gain: 0.24, env: { a: 0.002, d: 0.2, s: 0.0, r: 0.08 },
      filter: { freq: 700, q: 5, env: 2800, decay: 0.14 } },
    { id: 'acidBass', name: 'Acid Bass', group: 'PS1', type: 'wave', wave: 'saw', gain: 0.3, env: { a: 0.002, d: 0.16, s: 0.25, r: 0.06 },
      filter: { freq: 320, q: 7, env: 1900, decay: 0.15 } },
    { id: 'subBass', name: 'Sub Bass', group: 'PS1', type: 'sine', gain: 0.4, env: { a: 0.004, d: 0.06, s: 0.9, r: 0.07 },
      stack: [{ wave: 'sine', ratio: 1, gain: 1 }, { wave: 'triangle', ratio: 2, gain: 0.25 }] },
    { id: 'dreamPad', name: 'Dream Pad', group: 'PS1', type: 'wave', wave: 'saw', gain: 0.11, env: { a: 0.3, d: 0.4, s: 0.85, r: 0.7 }, vib: { depth: 5, speed: 4.2, delay: 0.3 },
      filter: { freq: 1500, q: 0.8 },
      stack: [{ wave: 'saw', detune: -11, gain: 0.8 }, { wave: 'saw', detune: 11, gain: 0.8 }, { wave: 'pulse50', ratio: 0.5, gain: 0.4 }] },
    { id: 'vibes', name: 'Vibraphone', group: 'PS1', type: 'sine', gain: 0.25, env: { a: 0.002, d: 0.9, s: 0.0, r: 0.5 }, vib: { depth: 10, speed: 4.5, delay: 0.05 },
      stack: [{ wave: 'sine', ratio: 1, gain: 1 }, { wave: 'sine', ratio: 4, gain: 0.18 }] },
    { id: 'orchHit', name: 'Orch Hit', group: 'PS1', type: 'wave', wave: 'saw', gain: 0.2, env: { a: 0.004, d: 0.28, s: 0.0, r: 0.12 },
      filter: { freq: 1200, q: 1, env: 2400, decay: 0.2 },
      stack: [{ wave: 'saw', detune: -10, gain: 0.9 }, { wave: 'saw', detune: 10, gain: 0.9 }, { wave: 'saw', ratio: 0.5, gain: 0.7 }] },

    // ===== N64 / 64-bit (lush, atmospheric, sampled-orchestra flavour) =====
    { id: 'n64Strings', name: 'Hall Strings', group: 'N64', type: 'wave', wave: 'saw', gain: 0.11, env: { a: 0.16, d: 0.25, s: 0.85, r: 0.45 }, vib: { depth: 7, speed: 4.8, delay: 0.25 },
      filter: { freq: 2600, q: 0.7 },
      stack: [{ wave: 'saw', detune: -8, gain: 0.85 }, { wave: 'saw', detune: 8, gain: 0.85 }, { wave: 'saw', ratio: 2, detune: 4, gain: 0.25 }] },
    { id: 'ambientPad', name: 'Ambient Pad', group: 'N64', type: 'wave', wave: 'triangle', gain: 0.13, env: { a: 0.45, d: 0.5, s: 0.9, r: 1.0 }, vib: { depth: 4, speed: 3.8, delay: 0.4 },
      filter: { freq: 1600, q: 0.6 },
      stack: [{ wave: 'triangle', detune: -9, gain: 0.9 }, { wave: 'saw', detune: 9, gain: 0.4 }, { wave: 'sine', ratio: 2, gain: 0.3 }] },
    { id: 'rhodes', name: 'Rhodes Keys', group: 'N64', type: 'sine', gain: 0.23, env: { a: 0.004, d: 0.5, s: 0.3, r: 0.3 }, vib: { depth: 5, speed: 4.5, delay: 0.2 },
      stack: [{ wave: 'sine', ratio: 1, gain: 1 }, { wave: 'sine', ratio: 2, detune: 6, gain: 0.25 }, { wave: 'sine', ratio: 5, gain: 0.05 }] },
    { id: 'musicBox', name: 'Music Box', group: 'N64', type: 'sine', gain: 0.24, env: { a: 0.002, d: 1.1, s: 0.0, r: 0.6 },
      stack: [{ wave: 'sine', ratio: 1, gain: 1 }, { wave: 'sine', ratio: 4, gain: 0.3 }, { wave: 'sine', ratio: 9.7, gain: 0.06 }] },
    { id: 'pizzicato', name: 'Pizzicato', group: 'N64', type: 'triangle', wave: 'triangle', gain: 0.3, env: { a: 0.002, d: 0.14, s: 0.0, r: 0.06 },
      filter: { freq: 900, q: 1.4, env: 1800, decay: 0.1 } },
    { id: 'glideLead', name: 'Smooth Lead', group: 'N64', type: 'triangle', wave: 'triangle', gain: 0.26, env: { a: 0.02, d: 0.1, s: 0.8, r: 0.18 }, vib: { depth: 12, speed: 5.2, delay: 0.2 },
      stack: [{ wave: 'triangle', ratio: 1, gain: 1 }, { wave: 'sine', ratio: 1, detune: 5, gain: 0.5 }] },
    { id: 'dreamSquare', name: 'Dream Square', group: 'N64', type: 'pulse', wave: 'pulse50', gain: 0.14, env: { a: 0.03, d: 0.12, s: 0.8, r: 0.25 }, vib: { depth: 7, speed: 4.6, delay: 0.2 },
      filter: { freq: 3200, q: 0.8 },
      stack: [{ wave: 'pulse50', detune: -6, gain: 0.85 }, { wave: 'pulse50', detune: 6, gain: 0.85 }] },
    { id: 'deepBass', name: 'Deep Bass', group: 'N64', type: 'sine', gain: 0.42, env: { a: 0.005, d: 0.1, s: 0.85, r: 0.1 },
      stack: [{ wave: 'sine', ratio: 1, gain: 1 }, { wave: 'triangle', ratio: 1, gain: 0.35 }, { wave: 'sine', ratio: 2, gain: 0.15 }] }
  ];

  var INSTRUMENT_MAP = {};
  INSTRUMENTS.forEach(function (i) { INSTRUMENT_MAP[i.id] = i; });

  // Group order for menus, with friendly labels.
  var GROUPS = ['NES', 'Drums', 'SNES', 'PS1', 'N64'];
  var GROUP_LABELS = {
    NES: 'NES · 8-bit', Drums: 'Drums & FX', SNES: 'SNES · 16-bit',
    PS1: 'PS1 · 32-bit', N64: 'N64 · 64-bit'
  };

  // ---- Console eras ---------------------------------------------------------
  // Each era shapes the master output (bit quantize, tone filter, reverb) and
  // gates which instrument groups appear in menus.
  var ERAS = {
    '8': { name: '8-BIT', desc: 'NES · crunchy pulse waves', bits: 8, lp: 10500, reverb: 0, groups: ['NES', 'Drums'] },
    '16': { name: '16-BIT', desc: 'SNES · warm sample-synth', bits: 12, lp: 15500, reverb: 0.12, groups: ['NES', 'Drums', 'SNES'] },
    '32': { name: '32-BIT', desc: 'PS1 · clean digital', bits: 0, lp: 18500, reverb: 0.18, groups: ['NES', 'Drums', 'SNES', 'PS1'] },
    '64': { name: '64-BIT', desc: 'N64 · lush & spacious', bits: 0, lp: 0, reverb: 0.28, groups: ['NES', 'Drums', 'SNES', 'PS1', 'N64'] }
  };
  var ERA_ORDER = ['8', '16', '32', '64'];

  function makeCrushCurve(bits) {
    var n = 4096, curve = new Float32Array(n);
    var levels = Math.pow(2, bits - 1);
    for (var i = 0; i < n; i++) {
      var x = (i / (n - 1)) * 2 - 1;
      curve[i] = Math.round(x * levels) / levels;
    }
    return curve;
  }

  function buildImpulse(ctx, seconds, decay) {
    var rate = ctx.sampleRate, len = Math.max(1, Math.floor(rate * seconds));
    var buf = ctx.createBuffer(2, len, rate);
    for (var c = 0; c < 2; c++) {
      var d = buf.getChannelData(c);
      for (var i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
    }
    return buf;
  }

  // Master FX chain for an era: input → [bit quantize] → [tone LP] → dry+reverb → out.
  // Used for both live playback and offline WAV rendering.
  function createMasterChain(ctx, eraKey) {
    var era = ERAS[eraKey] || ERAS['8'];
    var input = ctx.createGain();
    var node = input;
    if (era.bits) {
      var shaper = ctx.createWaveShaper();
      shaper.curve = makeCrushCurve(era.bits);
      node.connect(shaper); node = shaper;
    }
    if (era.lp) {
      var lp = ctx.createBiquadFilter();
      lp.type = 'lowpass'; lp.frequency.value = era.lp; lp.Q.value = 0.5;
      node.connect(lp); node = lp;
    }
    var out = ctx.createGain();
    node.connect(out);
    if (era.reverb > 0) {
      var conv = ctx.createConvolver();
      conv.buffer = buildImpulse(ctx, eraKey === '64' ? 2.4 : 1.7, 3);
      var wet = ctx.createGain(); wet.gain.value = era.reverb;
      node.connect(conv); conv.connect(wet); wet.connect(out);
    }
    out.connect(ctx.destination);
    return { input: input, output: out };
  }

  // ---- Voice construction --------------------------------------------------
  function createVoice(ctx, inst, opts) {
    var assets = getAssets(ctx);
    var t0 = opts.time;
    var dur = Math.max(0.02, opts.duration);
    var vel = (opts.velocity == null ? 1 : opts.velocity);
    var dest = opts.destination;
    var env = inst.env;
    var peak = inst.gain * vel;

    var amp = ctx.createGain();
    amp.gain.value = 0;
    amp.connect(dest);

    var noteOff = t0 + dur;
    var atkEnd = t0 + env.a;
    var decEnd = atkEnd + env.d;
    var sustainLevel = peak * env.s;
    amp.gain.setValueAtTime(0, t0);
    amp.gain.linearRampToValueAtTime(peak, atkEnd);
    amp.gain.linearRampToValueAtTime(sustainLevel, decEnd);
    if (decEnd < noteOff) amp.gain.setValueAtTime(sustainLevel, noteOff);
    var relEnd = noteOff + env.r;
    amp.gain.linearRampToValueAtTime(0.0001, relEnd);

    var stopTime = relEnd + 0.02;
    var freq = opts.freq;

    // Optional per-voice lowpass with a velocity-scaled envelope (acid/reso sounds).
    var target = amp;
    if (inst.filter) {
      var flt = ctx.createBiquadFilter();
      flt.type = inst.filter.type || 'lowpass';
      var f0 = inst.filter.freq;
      if (inst.filter.env) {
        flt.frequency.setValueAtTime(Math.min(18000, f0 + inst.filter.env * vel), t0);
        flt.frequency.exponentialRampToValueAtTime(Math.max(40, f0), t0 + (inst.filter.decay || 0.2));
      } else {
        flt.frequency.value = f0;
      }
      flt.Q.value = inst.filter.q || 0.7;
      flt.connect(amp);
      target = flt;
    }

    function makeOsc(wave, f, detuneCents, gainMul) {
      var osc = ctx.createOscillator();
      if (wave === 'sine') osc.type = 'sine';
      else osc.setPeriodicWave(assets.waves[wave]);
      if (inst.sweep) {
        osc.frequency.setValueAtTime(Math.max(20, f * inst.sweep.from), t0);
        osc.frequency.exponentialRampToValueAtTime(Math.max(20, f * inst.sweep.to), t0 + inst.sweep.time);
      } else {
        osc.frequency.value = f;
      }
      if (detuneCents) osc.detune.value = detuneCents;
      if (inst.vib && inst.vib.depth > 0) {
        var lfo = ctx.createOscillator();
        lfo.type = 'sine';
        lfo.frequency.value = inst.vib.speed;
        var lg = ctx.createGain();
        var delay = inst.vib.delay || 0;
        lg.gain.setValueAtTime(0, t0);
        lg.gain.setValueAtTime(0, t0 + delay);
        lg.gain.linearRampToValueAtTime(inst.vib.depth, t0 + delay + 0.08);
        lfo.connect(lg).connect(osc.detune);
        lfo.start(t0); lfo.stop(stopTime);
      }
      var out = osc;
      if (gainMul != null && gainMul !== 1) {
        var g = ctx.createGain(); g.gain.value = gainMul;
        osc.connect(g); out = g;
      }
      out.connect(target);
      osc.start(t0); osc.stop(stopTime);
    }

    if (inst.type === 'noise') {
      var src = ctx.createBufferSource();
      src.buffer = inst.noise === 'metal' ? assets.noiseMetal : assets.noiseWhite;
      src.loop = true;
      var ratio = Math.pow(2, (opts.midi - (inst.basePitch || 60)) / 12);
      src.playbackRate.value = Math.max(0.25, Math.min(4, ratio));
      src.connect(target);
      src.start(t0); src.stop(stopTime);
    } else if (inst.type === 'kick') {
      var d = inst.drop || { from: 2.2, to: 0.6, time: 0.09 };
      var osc = ctx.createOscillator();
      osc.setPeriodicWave(assets.waves.triangle);
      osc.frequency.setValueAtTime(Math.max(40, freq * d.from), t0);
      osc.frequency.exponentialRampToValueAtTime(Math.max(28, freq * d.to), t0 + d.time);
      osc.connect(target);
      osc.start(t0); osc.stop(stopTime);
    } else {
      // tonal: pulse / triangle / wave / sine, optionally a multi-osc stack
      var stack = inst.stack;
      if (!stack) {
        var w = inst.type === 'sine' ? 'sine' : inst.wave;
        stack = [{ wave: w, ratio: 1, detune: 0, gain: 1 }];
      }
      for (var i = 0; i < stack.length; i++) {
        var s = stack[i];
        makeOsc(s.wave, freq * (s.ratio || 1), s.detune || 0, s.gain == null ? 1 : s.gain);
      }
    }

    return { amp: amp };
  }

  // ---- Live engine ---------------------------------------------------------
  var Synth = {
    ctx: null, master: null, era: '8', _chain: null,
    INSTRUMENTS: INSTRUMENTS, INSTRUMENT_MAP: INSTRUMENT_MAP, GROUPS: GROUPS,
    GROUP_LABELS: GROUP_LABELS, ERAS: ERAS, ERA_ORDER: ERA_ORDER,
    midiToFreq: midiToFreq, createVoice: createVoice, getAssets: getAssets,
    createMasterChain: createMasterChain,

    ensure: function () {
      if (!this.ctx) {
        var AC = global.AudioContext || global.webkitAudioContext;
        this.ctx = new AC();
        this.master = this.ctx.createGain();
        this.master.gain.value = 0.8;
        this._chain = createMasterChain(this.ctx, this.era);
        this.master.connect(this._chain.input);
      }
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return this.ctx;
    },
    setEra: function (key) {
      if (!ERAS[key]) key = '8';
      if (this.era === key && this._chain) return;
      this.era = key;
      if (this.ctx) {
        this.master.disconnect();
        if (this._chain) this._chain.output.disconnect();
        this._chain = createMasterChain(this.ctx, key);
        this.master.connect(this._chain.input);
      }
    },
    groupsForEra: function (key) { return (ERAS[key] || ERAS['8']).groups; },
    setMasterVolume: function (v) { if (this.master) this.master.gain.value = v; },
    preview: function (instId, midi, dur) {
      this.ensure();
      var inst = INSTRUMENT_MAP[instId];
      if (!inst) return;
      createVoice(this.ctx, inst, {
        freq: midiToFreq(midi), midi: midi,
        time: this.ctx.currentTime + 0.01, duration: dur || 0.3,
        velocity: 1, destination: this.master
      });
    }
  };

  global.BBB = global.BBB || {};
  global.BBB.Synth = Synth;
})(window);
