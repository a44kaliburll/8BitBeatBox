/* ============================================================================
 * 8BitBeatBox — generator.js
 * One-click random song generator. Picks a game-music archetype (overworld,
 * dungeon, boss, chill…), a key/scale/tempo, an era-appropriate instrument
 * kit, then writes chord progressions, a melody (chord-tone-anchored random
 * walk), bass line, drums and an arrangement — a complete editable song.
 * ========================================================================== */
(function (global) {
  'use strict';

  function rnd(n) { return Math.floor(Math.random() * n); }
  function pick(arr) { return arr[rnd(arr.length)]; }
  function chance(p) { return Math.random() < p; }
  function range(lo, hi) { return lo + rnd(hi - lo + 1); }

  // ---- Random titles --------------------------------------------------------
  var T_ADJ = ['Neon', 'Pixel', 'Crystal', 'Shadow', 'Turbo', 'Cosmic', 'Retro', 'Midnight',
    'Golden', 'Frozen', 'Blazing', 'Lost', 'Hyper', 'Mystic', 'Electric', 'Ancient',
    'Starlit', 'Cyber', 'Emerald', 'Phantom', 'Lunar', 'Savage', 'Secret', 'Iron'];
  var T_NOUN = ['Quest', 'Runner', 'Cavern', 'Skyline', 'Fortress', 'Circuit', 'Voyage',
    'Arcade', 'Dungeon', 'Meadow', 'Storm', 'Galaxy', 'Temple', 'Rush', 'Drift',
    'Kingdom', 'Reactor', 'Horizon', 'Labyrinth', 'Comet', 'Glacier', 'Jungle'];

  // ---- Harmony material -----------------------------------------------------
  var QUAL = { maj: [0, 4, 7], min: [0, 3, 7] };

  // Progressions as [semitones-from-root, quality] per chord (4 chords = 1 pattern).
  var MINOR_PROGS = [
    [[0, 'min'], [8, 'maj'], [3, 'maj'], [10, 'maj']],
    [[0, 'min'], [5, 'min'], [8, 'maj'], [7, 'maj']],
    [[0, 'min'], [10, 'maj'], [8, 'maj'], [10, 'maj']],
    [[0, 'min'], [3, 'maj'], [10, 'maj'], [5, 'min']],
    [[0, 'min'], [8, 'maj'], [5, 'min'], [7, 'maj']],
    [[0, 'min'], [10, 'maj'], [3, 'maj'], [8, 'maj']]
  ];
  var MAJOR_PROGS = [
    [[0, 'maj'], [7, 'maj'], [9, 'min'], [5, 'maj']],
    [[0, 'maj'], [5, 'maj'], [7, 'maj'], [0, 'maj']],
    [[0, 'maj'], [9, 'min'], [5, 'maj'], [7, 'maj']],
    [[0, 'maj'], [4, 'min'], [5, 'maj'], [7, 'maj']],
    [[0, 'maj'], [5, 'maj'], [9, 'min'], [7, 'maj']]
  ];

  // ---- Game-music archetypes ------------------------------------------------
  var ARCHETYPES = [
    { name: 'overworld', bpm: [128, 165], minor: 0.35, fast: true, drums: ['rock', 'fast'], bass: ['eighths', 'octaves'], harm: ['arp', 'offbeat'] },
    { name: 'dungeon', bpm: [84, 110], minor: 0.9, fast: false, drums: ['half', 'rock'], bass: ['roots', 'walk'], harm: ['chord', 'arp'] },
    { name: 'boss', bpm: [158, 186], minor: 0.95, fast: true, drums: ['fast', 'breaky'], bass: ['walk', 'pump'], harm: ['arp', 'stab'] },
    { name: 'chill', bpm: [70, 96], minor: 0.4, fast: false, drums: ['half', 'sparse'], bass: ['roots', 'octaves'], harm: ['chord', 'arpDown'] },
    { name: 'action', bpm: [140, 172], minor: 0.6, fast: true, drums: ['fast', 'breaky'], bass: ['octaves', 'pump'], harm: ['offbeat', 'arp'] }
  ];

  // ---- Era-appropriate instrument kits ---------------------------------------
  var KITS = {
    '8': {
      lead: ['pulse25', 'pulseLead', 'pwmLead', 'pulse50', 'triLead', 'pulsePluck'],
      harm: ['pulse125', 'pulse25', 'nesOrgan', 'triPluck', 'pulseSoft'],
      bass: ['triBass', 'octaveBass']
    },
    '16': {
      lead: ['sawLead', 'fatSaw', 'brass', 'flute', 'pulseLead', 'superSaw', 'ePiano'],
      harm: ['strings', 'marimba', 'organ', 'bell', 'glass', 'choir', 'pad'],
      bass: ['triBass', 'octaveBass']
    },
    '32': {
      lead: ['digiLead', 'resoPluck', 'fmBell', 'vibes', 'sawLead', 'fmEPiano'],
      harm: ['dreamPad', 'fmEPiano', 'vibes', 'strings', 'fmBell'],
      bass: ['acidBass', 'subBass', 'octaveBass']
    },
    '64': {
      lead: ['glideLead', 'dreamSquare', 'rhodes', 'musicBox', 'digiLead'],
      harm: ['ambientPad', 'n64Strings', 'rhodes', 'dreamPad', 'pizzicato'],
      bass: ['deepBass', 'subBass', 'acidBass']
    }
  };

  // Lowest midi >= lo with pitch-class pc.
  function fit(pc, lo) { return lo + (((pc - lo) % 12) + 12) % 12; }

  // ---- Melody: chord-tone-anchored random walk ------------------------------
  function nextNote(prev, allowedPcs, lo, hi) {
    var cands = [], reach = 7;
    while (!cands.length && reach <= 24) {
      for (var m = Math.max(lo, prev - reach); m <= Math.min(hi, prev + reach); m++) {
        if (allowedPcs.indexOf(((m % 12) + 12) % 12) !== -1) cands.push(m);
      }
      reach += 5;
    }
    if (!cands.length) return prev;
    // Weight toward small steps so lines sing instead of leaping around.
    var weights = cands.map(function (m) {
      var d = Math.abs(m - prev);
      return d === 0 ? 0.3 : 1 / (1 + d * 0.55);
    });
    var sum = weights.reduce(function (a, b) { return a + b; }, 0);
    var r = Math.random() * sum;
    for (var i = 0; i < cands.length; i++) { r -= weights[i]; if (r <= 0) return cands[i]; }
    return cands[cands.length - 1];
  }

  function melody(chords, rootPc, scaleSteps, fast) {
    var scalePcs = scaleSteps.map(function (s) { return (rootPc + s) % 12; });
    var RHYTHMS = fast
      ? [[1, 1, 2, 4], [2, 2, 4], [1, 1, 1, 1, 2, 2], [2, 1, 1, 4], [4, 2, 2], [2, 2, 2, 2]]
      : [[4, 4], [2, 2, 4], [4, 2, 2], [8], [2, 6], [6, 2], [2, 2, 2, 2]];
    var notes = [];
    var prev = 70 + rnd(7);
    chords.forEach(function (c, ci) {
      var base = ci * 8;
      var chordPcs = QUAL[c[1]].map(function (iv) { return (rootPc + c[0] + iv) % 12; });
      var rhythm = pick(RHYTHMS);
      var t = 0;
      rhythm.forEach(function (len, ri) {
        if (t >= 8) return;
        var dur = Math.min(len, 8 - t);
        if (ri > 0 && chance(0.08)) { t += len; return; } // breathe occasionally
        var pcs = (ri === 0 || chance(0.55)) ? chordPcs : scalePcs;
        prev = nextNote(prev, pcs, 60, 88);
        notes.push({ t: base + t, dur: dur, midi: prev, vel: ri === 0 ? 1 : 0.75 + Math.random() * 0.25 });
        t += len;
      });
    });
    // Land the last phrase on the root for a resolved feel.
    if (notes.length) {
      var last = notes[notes.length - 1];
      last.midi = fit(rootPc, last.midi - 6 < 60 ? 60 : last.midi - 6);
    }
    return notes;
  }

  // ---- Bass -----------------------------------------------------------------
  function bassLine(chords, rootPc, style) {
    var notes = [];
    chords.forEach(function (c, ci) {
      var root = fit((rootPc + c[0]) % 12, 33);
      var triad = QUAL[c[1]];
      var base = ci * 8;
      if (style === 'roots') {
        notes.push({ t: base, dur: 8, midi: root, vel: 1 });
      } else if (style === 'walk') {
        [0, 2, 4, 6].forEach(function (k, i) {
          notes.push({ t: base + k, dur: 2, midi: root + triad[i % 3], vel: i === 0 ? 1 : 0.8 });
        });
      } else if (style === 'octaves') {
        for (var k = 0; k < 8; k += 2) {
          notes.push({ t: base + k, dur: 2, midi: (k % 4 === 0) ? root : root + 12, vel: k % 4 === 0 ? 1 : 0.8 });
        }
      } else if (style === 'pump') {
        for (var p = 0; p < 8; p++) notes.push({ t: base + p, dur: 1, midi: root, vel: p % 2 === 0 ? 1 : 0.75 });
      } else { // 'eighths'
        notes.push({ t: base, dur: 2, midi: root, vel: 1 });
        notes.push({ t: base + 2, dur: 2, midi: root, vel: 0.85 });
        notes.push({ t: base + 4, dur: 2, midi: root, vel: 1 });
        notes.push({ t: base + 6, dur: 2, midi: root + 7, vel: 0.85 });
      }
    });
    return notes;
  }

  // ---- Harmony --------------------------------------------------------------
  function harmonyLine(chords, rootPc, mode) {
    var notes = [];
    chords.forEach(function (c, ci) {
      var root = fit((rootPc + c[0]) % 12, 55);
      var triad = QUAL[c[1]];
      var base = ci * 8;
      if (mode === 'arp') {
        for (var k = 0; k < 8; k++) notes.push({ t: base + k, dur: 1, midi: root + triad[k % 3], vel: 0.6 });
      } else if (mode === 'arpDown') {
        for (var k2 = 0; k2 < 8; k2++) notes.push({ t: base + k2, dur: 1, midi: root + triad[2 - (k2 % 3)], vel: 0.55 });
      } else if (mode === 'chord') {
        triad.forEach(function (iv) { notes.push({ t: base, dur: 8, midi: root + iv, vel: 0.55 }); });
      } else if (mode === 'stab') {
        [0, 4].forEach(function (off) {
          triad.forEach(function (iv) { notes.push({ t: base + off, dur: 2, midi: root + iv, vel: 0.6 }); });
        });
      } else { // 'offbeat' — ska/action stabs on the off-eighths
        [2, 6].forEach(function (off) {
          triad.forEach(function (iv) { notes.push({ t: base + off, dur: 1, midi: root + iv, vel: 0.55 }); });
        });
      }
    });
    return notes;
  }

  // ---- Drums (kick channel + one pitched-noise channel) ----------------------
  var SNARE = 52, HAT = 74, OHAT = 66, CRASH = 60;
  function drumLine(style, withFill) {
    var kick = [], noise = [];
    function k(t, vel) { kick.push({ t: t, dur: 1, midi: 36, vel: vel || 1 }); }
    function n(t, midi, dur, vel) { noise.push({ t: t, dur: dur || 1, midi: midi, vel: vel || 1 }); }

    if (style === 'sparse') {
      [0, 16].forEach(function (t) { k(t); });
      for (var t1 = 4; t1 < 32; t1 += 8) n(t1, HAT, 1, 0.35);
    } else if (style === 'half') {
      [0, 16].forEach(function (t) { k(t); });
      [8, 24].forEach(function (t) { n(t, SNARE, 2, 0.95); });
      for (var t2 = 0; t2 < 32; t2 += 4) n(t2, HAT, 1, 0.4);
    } else if (style === 'fast') {
      for (var t3 = 0; t3 < 32; t3 += 4) k(t3);
      [4, 12, 20, 28].forEach(function (t) { n(t, SNARE, 2, 0.95); });
      for (var t4 = 0; t4 < 32; t4 += 2) n(t4, HAT, 1, 0.4);
    } else if (style === 'breaky') {
      [0, 6, 10, 16, 22, 26].forEach(function (t) { k(t); });
      [4, 12, 20, 28].forEach(function (t) { n(t, SNARE, 2, 0.95); });
      [15, 31].forEach(function (t) { n(t, SNARE, 1, 0.45); }); // ghost notes
      for (var t5 = 0; t5 < 32; t5 += 2) n(t5, HAT, 1, 0.38);
    } else { // 'rock'
      [0, 8, 16, 24].forEach(function (t) { k(t); });
      if (chance(0.6)) k(14, 0.85);
      if (chance(0.6)) k(30, 0.85);
      [4, 12, 20, 28].forEach(function (t) { n(t, SNARE, 2, 0.95); });
      for (var t6 = 0; t6 < 32; t6 += 2) n(t6, HAT, 1, 0.4);
      if (chance(0.5)) n(28, OHAT, 2, 0.5);
    }

    if (withFill) { // snare run into the next pattern
      noise = noise.filter(function (x) { return !(x.t >= 28 && x.midi === HAT); });
      [28, 29, 30, 31].forEach(function (t, i) { n(t, SNARE, 1, 0.5 + i * 0.15); });
    }
    if (chance(0.5)) n(0, CRASH, 4, 0.6);
    return { kick: kick, noise: noise };
  }

  // ---- Pattern & song assembly -----------------------------------------------
  function buildPattern(name, cfg) {
    var d = drumLine(cfg.drums, cfg.fill);
    return {
      name: name,
      notes: [
        melody(cfg.chords, cfg.rootPc, cfg.scaleSteps, cfg.fast),
        harmonyLine(cfg.chords, cfg.rootPc, cfg.harm),
        bassLine(cfg.chords, cfg.rootPc, cfg.bass),
        d.kick,
        d.noise
      ]
    };
  }

  function generate(era) {
    var Song = global.BBB.Song;
    era = (global.BBB.Synth.ERAS[era]) ? era : '8';
    var arch = pick(ARCHETYPES);
    var minor = chance(arch.minor);
    var rootPc = rnd(12);
    var scale = minor ? pick(['minor', 'minor', 'harmonicMinor', 'dorian'])
                      : pick(['major', 'major', 'mixolydian', 'pentatonicMajor']);
    var scaleSteps = Song.SCALES[scale].steps;
    var progs = minor ? MINOR_PROGS : MAJOR_PROGS;
    var bpm = range(arch.bpm[0], arch.bpm[1]);

    var kit = KITS[era];
    var leadInst = pick(kit.lead), harmInst = pick(kit.harm), bassInst = pick(kit.bass);

    var common = { rootPc: rootPc, scaleSteps: scaleSteps, fast: arch.fast };
    function cfg(extra) {
      var o = { rootPc: common.rootPc, scaleSteps: common.scaleSteps, fast: common.fast };
      for (var k in extra) o[k] = extra[k];
      return o;
    }

    var progA = pick(progs), progB = pick(progs);
    var drumsA = pick(arch.drums), drumsB = pick(arch.drums);
    var bassStyle = pick(arch.bass), harmStyle = pick(arch.harm);

    var patterns = [
      buildPattern('Verse', cfg({ chords: progA, drums: drumsA, bass: bassStyle, harm: harmStyle })),
      buildPattern('Chorus', cfg({ chords: progB, drums: drumsB, bass: bassStyle, harm: pick(arch.harm), fill: true }))
    ];
    var sequence;
    if (chance(0.4)) { // add a stripped-down bridge
      patterns.push(buildPattern('Bridge', cfg({ chords: pick(progs), drums: 'sparse', bass: 'roots', harm: 'chord' })));
      sequence = pick([[0, 0, 1, 2, 0, 1], [0, 1, 2, 1], [0, 0, 1, 2]]);
    } else {
      sequence = pick([[0, 0, 1, 0], [0, 1, 0, 1], [0, 0, 1, 1]]);
    }

    var COL = Song.CHANNEL_COLORS;
    function ch(name, instId, vol, color) {
      return { name: name, instId: instId, volume: vol, mute: false, solo: false, color: color };
    }

    return Song.deserialize({
      v: 1,
      title: pick(T_ADJ) + ' ' + pick(T_NOUN),
      bpm: bpm, era: era,
      stepsPerBeat: 4, beatsPerBar: 4, barsPerPattern: 2,
      rootPc: rootPc, scale: scale,
      channels: [
        ch('Lead', leadInst, 0.85, COL[0]),
        ch('Harmony', harmInst, 0.6, COL[1]),
        ch('Bass', bassInst, 0.9, COL[2]),
        ch('Kick', 'kick', 0.9, COL[3]),
        ch('Drums', 'noiseHat', 0.7, COL[4])
      ],
      patterns: patterns,
      sequence: sequence
    });
  }

  global.BBB = global.BBB || {};
  global.BBB.Generator = { generate: generate };
})(window);
