/* ============================================================================
 * 8BitBeatBox — song.js
 * The data model: a Song owns global settings, a set of Channels, a list of
 * Patterns (each Pattern holds notes per channel), and a Sequence that orders
 * patterns into a full arrangement.
 * ========================================================================== */
(function (global) {
  'use strict';

  var NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

  // Scales as semitone offsets from the root.
  var SCALES = {
    chromatic: { name: 'Chromatic', steps: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11] },
    major: { name: 'Major', steps: [0, 2, 4, 5, 7, 9, 11] },
    minor: { name: 'Natural Minor', steps: [0, 2, 3, 5, 7, 8, 10] },
    harmonicMinor: { name: 'Harmonic Minor', steps: [0, 2, 3, 5, 7, 8, 11] },
    dorian: { name: 'Dorian', steps: [0, 2, 3, 5, 7, 9, 10] },
    phrygian: { name: 'Phrygian', steps: [0, 1, 3, 5, 7, 8, 10] },
    mixolydian: { name: 'Mixolydian', steps: [0, 2, 4, 5, 7, 9, 10] },
    pentatonicMajor: { name: 'Major Pentatonic', steps: [0, 2, 4, 7, 9] },
    pentatonicMinor: { name: 'Minor Pentatonic', steps: [0, 3, 5, 7, 10] },
    blues: { name: 'Blues', steps: [0, 3, 5, 6, 7, 10] }
  };

  function noteName(midi) {
    return NOTE_NAMES[((midi % 12) + 12) % 12] + (Math.floor(midi / 12) - 1);
  }

  function isInScale(midi, rootPc, scaleKey) {
    var scale = SCALES[scaleKey] || SCALES.chromatic;
    var pc = (((midi - rootPc) % 12) + 12) % 12;
    return scale.steps.indexOf(pc) !== -1;
  }

  var CHANNEL_COLORS = [
    '#39c5ff', // cyan
    '#ff5fd2', // pink
    '#5dff7a', // green
    '#ffd23f', // yellow
    '#b78bff', // purple
    '#ff8a3d', // orange
    '#3dffe0', // teal
    '#ff5f5f'  // red
  ];

  var uidCounter = 1;
  function uid() { return uidCounter++; }

  function defaultChannel(instId, name, color) {
    return { id: uid(), name: name, instId: instId, volume: 0.8, mute: false, solo: false, color: color };
  }

  function emptyPattern(name, channelCount) {
    var notes = [];
    for (var i = 0; i < channelCount; i++) notes.push([]);
    return { id: uid(), name: name, notes: notes };
  }

  function createDefaultSong() {
    var channels = [
      defaultChannel('pulse25', 'Pulse A', CHANNEL_COLORS[0]),
      defaultChannel('pulse125', 'Pulse B', CHANNEL_COLORS[1]),
      defaultChannel('triBass', 'Triangle', CHANNEL_COLORS[2]),
      defaultChannel('noiseHat', 'Noise', CHANNEL_COLORS[3])
    ];
    var song = {
      title: 'Untitled Chiptune',
      bpm: 120,
      stepsPerBeat: 4,   // grid resolution (4 = sixteenth notes)
      beatsPerBar: 4,
      barsPerPattern: 2,
      rootPc: 0,         // C
      scale: 'minor',
      channels: channels,
      patterns: [emptyPattern('Pattern 1', channels.length)],
      sequence: [0]      // arrangement: indices into patterns[]
    };
    return song;
  }

  // Steps per pattern derived from time settings.
  function patternSteps(song) {
    return song.stepsPerBeat * song.beatsPerBar * song.barsPerPattern;
  }

  // ---- Mutation helpers ----------------------------------------------------
  function addChannel(song, instId) {
    var idx = song.channels.length;
    var color = CHANNEL_COLORS[idx % CHANNEL_COLORS.length];
    var inst = global.BBB.Synth.INSTRUMENT_MAP[instId] || global.BBB.Synth.INSTRUMENTS[0];
    song.channels.push(defaultChannel(inst.id, inst.name, color));
    // Every pattern needs a note bucket for the new channel.
    song.patterns.forEach(function (p) { p.notes.push([]); });
  }

  function removeChannel(song, chIndex) {
    if (song.channels.length <= 1) return;
    song.channels.splice(chIndex, 1);
    song.patterns.forEach(function (p) { p.notes.splice(chIndex, 1); });
  }

  function addPattern(song, copyFromIndex) {
    var name = 'Pattern ' + (song.patterns.length + 1);
    var p = emptyPattern(name, song.channels.length);
    if (copyFromIndex != null && song.patterns[copyFromIndex]) {
      var src = song.patterns[copyFromIndex];
      p.notes = src.notes.map(function (arr) {
        return arr.map(function (n) { return { t: n.t, dur: n.dur, midi: n.midi, vel: n.vel }; });
      });
    }
    song.patterns.push(p);
    return song.patterns.length - 1;
  }

  // ---- Serialization -------------------------------------------------------
  function serialize(song) {
    return JSON.stringify({
      v: 1,
      title: song.title,
      bpm: song.bpm,
      stepsPerBeat: song.stepsPerBeat,
      beatsPerBar: song.beatsPerBar,
      barsPerPattern: song.barsPerPattern,
      rootPc: song.rootPc,
      scale: song.scale,
      channels: song.channels.map(function (c) {
        return { name: c.name, instId: c.instId, volume: c.volume, mute: c.mute, solo: c.solo, color: c.color };
      }),
      patterns: song.patterns.map(function (p) { return { name: p.name, notes: p.notes }; }),
      sequence: song.sequence
    });
  }

  function deserialize(json) {
    var d = (typeof json === 'string') ? JSON.parse(json) : json;
    var song = {
      title: d.title || 'Untitled',
      bpm: d.bpm || 120,
      stepsPerBeat: d.stepsPerBeat || 4,
      beatsPerBar: d.beatsPerBar || 4,
      barsPerPattern: d.barsPerPattern || 2,
      rootPc: d.rootPc || 0,
      scale: d.scale || 'minor',
      channels: (d.channels || []).map(function (c, i) {
        return {
          id: uid(), name: c.name, instId: c.instId,
          volume: c.volume == null ? 0.8 : c.volume,
          mute: !!c.mute, solo: !!c.solo,
          color: c.color || CHANNEL_COLORS[i % CHANNEL_COLORS.length]
        };
      }),
      patterns: (d.patterns || []).map(function (p) {
        return { id: uid(), name: p.name, notes: p.notes };
      }),
      sequence: d.sequence && d.sequence.length ? d.sequence : [0]
    };
    return song;
  }

  global.BBB = global.BBB || {};
  global.BBB.Song = {
    NOTE_NAMES: NOTE_NAMES,
    SCALES: SCALES,
    CHANNEL_COLORS: CHANNEL_COLORS,
    noteName: noteName,
    isInScale: isInScale,
    createDefaultSong: createDefaultSong,
    patternSteps: patternSteps,
    addChannel: addChannel,
    removeChannel: removeChannel,
    addPattern: addPattern,
    emptyPattern: emptyPattern,
    serialize: serialize,
    deserialize: deserialize
  };
})(window);
