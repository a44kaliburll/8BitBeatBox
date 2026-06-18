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
      stack: [{ wave: 'triangle', detune: -6, gain: 0.8 }, { wave: 'saw', detune: 6, gain: 0.35 }] }
  ];

  var INSTRUMENT_MAP = {};
  INSTRUMENTS.forEach(function (i) { INSTRUMENT_MAP[i.id] = i; });

  // Group order for menus.
  var GROUPS = ['NES', 'Drums', 'SNES'];

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
      out.connect(amp);
      osc.start(t0); osc.stop(stopTime);
    }

    if (inst.type === 'noise') {
      var src = ctx.createBufferSource();
      src.buffer = inst.noise === 'metal' ? assets.noiseMetal : assets.noiseWhite;
      src.loop = true;
      var ratio = Math.pow(2, (opts.midi - (inst.basePitch || 60)) / 12);
      src.playbackRate.value = Math.max(0.25, Math.min(4, ratio));
      src.connect(amp);
      src.start(t0); src.stop(stopTime);
    } else if (inst.type === 'kick') {
      var d = inst.drop || { from: 2.2, to: 0.6, time: 0.09 };
      var osc = ctx.createOscillator();
      osc.setPeriodicWave(assets.waves.triangle);
      osc.frequency.setValueAtTime(Math.max(40, freq * d.from), t0);
      osc.frequency.exponentialRampToValueAtTime(Math.max(28, freq * d.to), t0 + d.time);
      osc.connect(amp);
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
    ctx: null, master: null,
    INSTRUMENTS: INSTRUMENTS, INSTRUMENT_MAP: INSTRUMENT_MAP, GROUPS: GROUPS,
    midiToFreq: midiToFreq, createVoice: createVoice, getAssets: getAssets,

    ensure: function () {
      if (!this.ctx) {
        var AC = global.AudioContext || global.webkitAudioContext;
        this.ctx = new AC();
        this.master = this.ctx.createGain();
        this.master.gain.value = 0.8;
        this.master.connect(this.ctx.destination);
      }
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return this.ctx;
    },
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
