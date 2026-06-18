/* ============================================================================
 * 8BitBeatBox — demo.js
 * A small library of ready-made chiptunes. Each demo is described declaratively
 * (key, tempo, instruments, chord progressions, lead lines, drum/bass styles)
 * and assembled by buildSong(), so they stay short to author and easy to vary.
 * ========================================================================== */
(function (global) {
  'use strict';

  var PC = { C: 0, 'C#': 1, D: 2, 'D#': 3, E: 4, F: 5, 'F#': 6, G: 7, 'G#': 8, A: 9, 'A#': 10, B: 11 };
  var QUAL = { min: [0, 3, 7], maj: [0, 4, 7], dim: [0, 3, 6] };

  // Lowest note >= `lo` having pitch-class `pc`.
  function pick(pc, lo) { return lo + (((pc - lo) % 12) + 12) % 12; }
  function bassRoot(pc) { return pick(pc, 33); }   // ~C1..B1
  function harmRoot(pc) { return pick(pc, 55); }   // ~G3..F#4

  // --- drum patterns (channels 3 = kick, 4 = noise) ---
  function drums(style, kickCh, noiseCh, hatId) {
    var steps = 32;
    function add(arr, ts, midi, dur, vel) { ts.forEach(function (t) { arr.push({ t: t, dur: dur, midi: midi, vel: vel }); }); }
    if (style === 'none') return;
    if (style === 'half') {
      add(kickCh, [0, 16], 36, 1, 1);
      add(noiseCh, [8, 24], 52, 2, 0.95);              // snare
      for (var t = 0; t < steps; t += 4) noiseCh.push({ t: t, dur: 1, midi: 74, vel: 0.4 });
    } else if (style === 'fast') {
      add(kickCh, [0, 4, 8, 12, 16, 20, 24, 28], 36, 1, 1);
      add(noiseCh, [4, 12, 20, 28], 52, 2, 0.95);
      for (var t2 = 0; t2 < steps; t2 += 2) noiseCh.push({ t: t2, dur: 1, midi: 76, vel: 0.4 });
    } else { // 'rock' (default)
      add(kickCh, [0, 8, 16, 24, 14, 30], 36, 1, 1);
      add(noiseCh, [4, 12, 20, 28], 52, 2, 0.95);
      for (var t3 = 0; t3 < steps; t3 += 2) noiseCh.push({ t: t3, dur: 1, midi: 74, vel: 0.4 });
    }
  }

  function bass(style, chords, ch) {
    chords.forEach(function (c, ci) {
      var root = bassRoot(PC[c[0]]), base = ci * 8;
      if (style === 'roots') {
        ch.push({ t: base, dur: 8, midi: root, vel: 1 });
      } else if (style === 'walk') {
        var triad = QUAL[c[1]];
        [0, 2, 4, 6].forEach(function (k, idx) { ch.push({ t: base + k, dur: 2, midi: root + triad[idx % 3], vel: idx === 0 ? 1 : 0.8 }); });
      } else { // 'eighths'
        ch.push({ t: base, dur: 2, midi: root, vel: 1 });
        ch.push({ t: base + 2, dur: 2, midi: root, vel: 0.85 });
        ch.push({ t: base + 4, dur: 2, midi: root, vel: 1 });
        ch.push({ t: base + 6, dur: 2, midi: root + 7, vel: 0.85 });
      }
    });
  }

  function harmony(mode, chords, ch) {
    chords.forEach(function (c, ci) {
      var pc = PC[c[0]], triad = QUAL[c[1]], base = ci * 8;
      if (mode === 'arp') {
        for (var k = 0; k < 8; k++) ch.push({ t: base + k, dur: 1, midi: harmRoot(pc) + triad[k % 3], vel: 0.65 });
      } else if (mode === 'chord') {
        triad.forEach(function (iv) { ch.push({ t: base, dur: 8, midi: harmRoot(pc) + iv, vel: 0.6 }); });
      } else if (mode === 'stab') {
        [0, 4].forEach(function (off) { triad.forEach(function (iv) { ch.push({ t: base + off, dur: 2, midi: harmRoot(pc) + iv, vel: 0.6 }); }); });
      }
    });
  }

  function buildSong(cfg) {
    var channels = cfg.channels;
    var patterns = cfg.patterns.map(function (p) {
      var ch = [[], [], [], [], []];
      p.lead.forEach(function (n) { ch[0].push({ t: n[1], dur: n[2], midi: n[0], vel: n[3] == null ? 1 : n[3] }); });
      harmony(p.harmony || 'arp', p.chords, ch[1]);
      bass(p.bass || 'eighths', p.chords, ch[2]);
      drums(p.drums || 'rock', ch[3], ch[4]);
      return { name: p.name, notes: ch };
    });
    return global.BBB.Song.deserialize({
      v: 1, title: cfg.title, bpm: cfg.bpm,
      stepsPerBeat: 4, beatsPerBar: 4, barsPerPattern: 2,
      rootPc: cfg.rootPc, scale: cfg.scale,
      channels: channels, patterns: patterns, sequence: cfg.sequence
    });
  }

  function ch(name, instId, vol, color) { return { name: name, instId: instId, volume: vol, mute: false, solo: false, color: color }; }
  var COL = ['#3ad6ff', '#ff5fd2', '#7dff8a', '#ffd23f', '#b78bff'];
  function kit(lead, arp, bass) {
    return [ch('Lead', lead, 0.85, COL[0]), ch('Harmony', arp, 0.6, COL[1]), ch('Bass', bass, 0.9, COL[2]),
            ch('Kick', 'kick', 0.9, COL[3]), ch('Noise', 'noiseHat', 0.7, COL[4])];
  }

  // ====================  DEMO DEFINITIONS  ================================
  var DEFS = [
    {
      id: 'neon', name: 'Neon Quest', desc: 'Upbeat A-minor adventure · 140 BPM',
      cfg: {
        title: 'Neon Quest', bpm: 140, rootPc: 9, scale: 'minor',
        channels: kit('pulse25', 'pulse125', 'triBass'),
        sequence: [0, 0, 1, 0],
        patterns: [
          { name: 'Verse', chords: [['A', 'min'], ['F', 'maj'], ['C', 'maj'], ['G', 'maj']], drums: 'rock', bass: 'eighths', harmony: 'arp',
            lead: [[76, 0, 2], [79, 2, 2], [81, 4, 4], [79, 8, 2], [76, 10, 2], [77, 12, 4], [76, 16, 2], [74, 18, 2], [72, 20, 4], [74, 24, 2], [76, 26, 2], [69, 28, 4]] },
          { name: 'Chorus', chords: [['A', 'min'], ['G', 'maj'], ['F', 'maj'], ['E', 'maj']], drums: 'rock', bass: 'eighths', harmony: 'arp',
            lead: [[81, 0, 2], [83, 2, 2], [84, 4, 2], [83, 6, 2], [81, 8, 4], [79, 12, 4], [77, 16, 2], [79, 18, 2], [81, 20, 2], [79, 22, 2], [76, 24, 4], [80, 28, 4]] }
        ]
      }
    },
    {
      id: 'castle', name: 'Castle Halls', desc: 'Slow, dark D-minor dungeon · 96 BPM',
      cfg: {
        title: 'Castle Halls', bpm: 96, rootPc: 2, scale: 'harmonicMinor',
        channels: kit('pulseSoft', 'nesOrgan', 'octaveBass'),
        sequence: [0, 1, 0, 1],
        patterns: [
          { name: 'Theme', chords: [['D', 'min'], ['A', 'maj'], ['D', 'min'], ['G', 'min']], drums: 'half', bass: 'roots', harmony: 'chord',
            lead: [[74, 0, 4], [77, 4, 4], [76, 8, 4], [74, 12, 4], [69, 16, 4], [72, 20, 4], [74, 24, 8]] },
          { name: 'Rise', chords: [['D', 'min'], ['F', 'maj'], ['C', 'maj'], ['A', 'maj']], drums: 'half', bass: 'roots', harmony: 'chord',
            lead: [[81, 0, 4], [80, 4, 4], [77, 8, 4], [74, 12, 4], [77, 16, 2], [78, 18, 2], [81, 20, 4], [86, 24, 8]] }
        ]
      }
    },
    {
      id: 'bubble', name: 'Bubble Pop', desc: 'Bouncy C major-pentatonic · 132 BPM',
      cfg: {
        title: 'Bubble Pop', bpm: 132, rootPc: 0, scale: 'pentatonicMajor',
        channels: kit('pulsePluck', 'triPluck', 'triBass'),
        sequence: [0, 0, 1, 0],
        patterns: [
          { name: 'A', chords: [['C', 'maj'], ['A', 'min'], ['F', 'maj'], ['G', 'maj']], drums: 'rock', bass: 'eighths', harmony: 'stab',
            lead: [[72, 0, 2], [76, 2, 2], [79, 4, 2], [76, 6, 2], [81, 8, 4], [79, 12, 2], [76, 14, 2], [77, 16, 2], [81, 18, 2], [79, 20, 4], [76, 24, 2], [72, 26, 2], [74, 28, 4]] },
          { name: 'B', chords: [['F', 'maj'], ['G', 'maj'], ['C', 'maj'], ['C', 'maj']], drums: 'fast', bass: 'eighths', harmony: 'stab',
            lead: [[84, 0, 2], [81, 2, 2], [79, 4, 2], [76, 6, 2], [79, 8, 2], [81, 10, 2], [84, 12, 4], [83, 16, 2], [81, 18, 2], [79, 20, 2], [76, 22, 2], [72, 24, 8]] }
        ]
      }
    },
    {
      id: 'boss', name: 'Boss Rush', desc: 'Intense E harmonic-minor · 168 BPM',
      cfg: {
        title: 'Boss Rush', bpm: 168, rootPc: 4, scale: 'harmonicMinor',
        channels: kit('pwmLead', 'pulse125', 'octaveBass'),
        sequence: [0, 0, 1, 1],
        patterns: [
          { name: 'Charge', chords: [['E', 'min'], ['C', 'maj'], ['D', 'maj'], ['B', 'maj']], drums: 'fast', bass: 'walk', harmony: 'arp',
            lead: [[76, 0, 1], [79, 1, 1], [83, 2, 2], [79, 4, 1], [76, 5, 1], [83, 6, 2], [84, 8, 2], [83, 10, 2], [81, 12, 2], [83, 14, 2], [79, 16, 4], [76, 20, 2], [75, 22, 2], [76, 24, 4], [83, 28, 4]] },
          { name: 'Clash', chords: [['E', 'min'], ['G', 'maj'], ['A', 'min'], ['B', 'maj']], drums: 'fast', bass: 'walk', harmony: 'arp',
            lead: [[88, 0, 2], [87, 2, 2], [83, 4, 2], [79, 6, 2], [76, 8, 2], [79, 10, 2], [83, 12, 4], [81, 16, 2], [79, 18, 2], [76, 20, 2], [75, 22, 2], [76, 24, 8]] }
        ]
      }
    },
    {
      id: 'sky', name: 'Sky Overworld', desc: 'Breezy G-major journey · 150 BPM',
      cfg: {
        title: 'Sky Overworld', bpm: 150, rootPc: 7, scale: 'major',
        channels: kit('pulse25', 'pulse50', 'triBass'),
        sequence: [0, 1, 0, 1],
        patterns: [
          { name: 'Sky A', chords: [['G', 'maj'], ['D', 'maj'], ['E', 'min'], ['C', 'maj']], drums: 'rock', bass: 'eighths', harmony: 'arp',
            lead: [[79, 0, 2], [83, 2, 2], [86, 4, 4], [83, 8, 2], [79, 10, 2], [81, 12, 4], [79, 16, 2], [76, 18, 2], [78, 20, 2], [79, 22, 2], [83, 24, 4], [86, 28, 4]] },
          { name: 'Sky B', chords: [['C', 'maj'], ['G', 'maj'], ['A', 'min'], ['D', 'maj']], drums: 'rock', bass: 'eighths', harmony: 'arp',
            lead: [[84, 0, 2], [83, 2, 2], [79, 4, 4], [81, 8, 2], [83, 10, 2], [84, 12, 4], [86, 16, 4], [83, 20, 2], [79, 22, 2], [78, 24, 2], [79, 26, 2], [83, 28, 4]] }
        ]
      }
    }
  ];

  var DEMOS = DEFS.map(function (d) {
    return { id: d.id, name: d.name, desc: d.desc, build: function () { return buildSong(d.cfg); } };
  });

  global.BBB.Demo = {
    DEMOS: DEMOS,
    createDemoSong: function () { return DEMOS[0].build(); }
  };
})(window);
