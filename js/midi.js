/* ============================================================================
 * 8BitBeatBox — midi.js
 * A dependency-free Standard MIDI File (.mid) parser + converter. parse() reads
 * the binary into note events; toSong() quantises them onto the step grid and
 * maps each MIDI track/channel to a chiptune instrument, producing an editable
 * 8BitBeatBox song. This is the "turn any song into an 8-bit song" path.
 * ========================================================================== */
(function (global) {
  'use strict';

  // ---- Binary parse --------------------------------------------------------
  function parse(buffer) {
    var dv = new DataView(buffer);
    var pos = 0;
    function str(n) { var s = ''; for (var i = 0; i < n; i++) s += String.fromCharCode(dv.getUint8(pos++)); return s; }
    function u8() { return dv.getUint8(pos++); }
    function u16() { var v = dv.getUint16(pos); pos += 2; return v; }
    function u32() { var v = dv.getUint32(pos); pos += 4; return v; }
    function varlen() { var v = 0, c; do { c = u8(); v = (v << 7) | (c & 0x7f); } while (c & 0x80); return v; }

    if (str(4) !== 'MThd') throw new Error('Not a MIDI file');
    u32();                              // header length
    var format = u16();
    var ntracks = u16();
    var division = u16();
    if (division & 0x8000) division = 480; // SMPTE timing — fall back to a PPQ

    var tempo = 500000;                 // microseconds per quarter (120 BPM)
    var tempoFound = false;
    var timeSigNum = 4;
    var name = '';
    var programByChannel = {};
    var notes = [];

    for (var tk = 0; tk < ntracks; tk++) {
      if (pos + 8 > dv.byteLength) break;
      if (str(4) !== 'MTrk') { var skip = u32(); pos += skip; continue; }
      var len = u32(), end = pos + len;
      var absTick = 0, status = 0;
      var active = {};                  // chan*128+note -> {tick, vel}

      function open(chan, note, vel, tick) {
        var k = chan * 128 + note;
        if (active[k]) close(chan, note, tick);
        active[k] = { tick: tick, vel: vel };
      }
      function close(chan, note, tick) {
        var k = chan * 128 + note, st = active[k];
        if (!st) return;
        notes.push({ track: tk, channel: chan, midi: note, tick: st.tick, durTicks: Math.max(1, tick - st.tick), vel: st.vel });
        delete active[k];
      }

      while (pos < end) {
        absTick += varlen();
        var peek = dv.getUint8(pos);
        if (peek & 0x80) { status = peek; pos++; }

        if (status === 0xFF) {           // meta
          var meta = u8(), mlen = varlen();
          if (meta === 0x51 && mlen === 3) {
            var t = (u8() << 16) | (u8() << 8) | u8();
            if (!tempoFound) { tempo = t; tempoFound = true; }
          } else if (meta === 0x58 && mlen >= 1) {
            timeSigNum = u8(); pos += mlen - 1;
          } else if (meta === 0x03 && !name) {
            for (var i = 0; i < mlen; i++) name += String.fromCharCode(u8());
          } else { pos += mlen; }
          status = 0;                    // meta cancels running status
        } else if (status === 0xF0 || status === 0xF7) {
          pos += varlen();               // sysex — skip
          status = 0;
        } else {
          var type = status & 0xF0, chan = status & 0x0F;
          if (type === 0x90) { var n1 = u8(), v1 = u8(); if (v1 > 0) open(chan, n1, v1, absTick); else close(chan, n1, absTick); }
          else if (type === 0x80) { var n2 = u8(); u8(); close(chan, n2, absTick); }
          else if (type === 0xC0) { programByChannel[chan] = u8(); }
          else if (type === 0xD0) { u8(); }
          else { u8(); u8(); }           // 0xA0 / 0xB0 / 0xE0
        }
      }
      // close any hanging notes at track end
      for (var key in active) {
        var c = Math.floor(key / 128), nn = key % 128;
        notes.push({ track: tk, channel: c, midi: nn, tick: active[key].tick, durTicks: 1, vel: active[key].vel });
      }
      pos = end;
    }

    if (!notes.length) throw new Error('No notes found in this MIDI file');
    return { format: format, division: division, tempo: tempo, timeSigNum: timeSigNum, name: name.trim(), programByChannel: programByChannel, notes: notes };
  }

  // ---- General MIDI program family → chiptune instrument -------------------
  var FAMILY = ['pulse50', 'marimba', 'organ', 'pulse25', 'triBass', 'strings', 'strings',
    'brass', 'pulse25', 'flute', 'pulse25', 'pad', 'sawLead', 'pulse125', 'triPluck', 'laser'];

  function pickInstrument(program, avgPitch, idx) {
    if (program != null) {
      var inst = FAMILY[Math.floor(program / 8)] || 'pulse25';
      if (avgPitch < 42 && inst !== 'triBass') inst = 'triBass'; // low register → bass voice
      return inst;
    }
    if (avgPitch < 46) return 'triBass';
    return ['pulse25', 'pulse125', 'pulse50', 'triLead', 'pulseLead'][idx % 5];
  }

  // ---- Convert parsed MIDI → 8BitBeatBox song ------------------------------
  function toSong(parsed, opts) {
    opts = opts || {};
    var Song = global.BBB.Song, Synth = global.BBB.Synth;
    var spb = opts.stepsPerBeat || 4;
    var div = parsed.division || 480;
    var beatsPerBar = parsed.timeSigNum || 4;
    var bpm = Math.max(20, Math.min(400, Math.round(60000000 / (parsed.tempo || 500000))));
    var colors = Song.CHANNEL_COLORS;
    var MAXCH = 8;

    // Group notes: prefer grouping by MIDI channel; if everything is on one
    // channel (common single-channel exports) fall back to grouping by track.
    var chSet = {}; parsed.notes.forEach(function (n) { chSet[n.channel] = 1; });
    var byChannel = Object.keys(chSet).length >= 2;
    var groups = {};
    parsed.notes.forEach(function (n) {
      var k = byChannel ? n.channel : 't' + n.track;
      (groups[k] = groups[k] || []).push(n);
    });
    var list = Object.keys(groups).map(function (k) {
      var ns = groups[k];
      return { notes: ns, isDrums: ns.some(function (n) { return n.channel === 9; }), program: parsed.programByChannel[ns[0].channel] };
    }).sort(function (a, b) { return b.notes.length - a.notes.length; });

    var channels = [], patternNotes = [], melIdx = 0, drumKick = -1, drumNoise = -1;
    function addCh(nm, instId) {
      var i = channels.length;
      channels.push({ name: nm, instId: instId, volume: 0.8, mute: false, solo: false, color: colors[i % colors.length] });
      patternNotes.push([]);
      return i;
    }
    function fold(m) { while (m < 24) m += 12; while (m > 96) m -= 12; return m; }
    function qStep(tick) { return Math.round((tick / div) * spb); }
    function qDur(dt) { return Math.max(1, Math.round((dt / div) * spb)); }
    function vel(v) { return Math.max(0.2, Math.min(1, v / 127)); }

    list.forEach(function (g) {
      if (g.isDrums) {
        if (drumKick < 0 && channels.length < MAXCH) drumKick = addCh('Kick', 'kick');
        if (drumNoise < 0 && channels.length < MAXCH) drumNoise = addCh('Drums', 'noiseHat');
        g.notes.forEach(function (n) {
          var step = qStep(n.tick), gm = n.midi;
          if ((gm === 35 || gm === 36) && drumKick >= 0) patternNotes[drumKick].push({ t: step, dur: 1, midi: 36, vel: vel(n.vel) });
          else if (drumNoise >= 0) {
            var pitch = (gm === 37 || gm === 38 || gm === 39 || gm === 40) ? 52 : (gm >= 49 && gm <= 59) ? 80 : (gm >= 41 && gm <= 50) ? 60 : 74;
            patternNotes[drumNoise].push({ t: step, dur: 1, midi: pitch, vel: vel(n.vel) });
          }
        });
      } else {
        if (channels.length >= MAXCH) return;
        var avg = 0; g.notes.forEach(function (n) { avg += n.midi; }); avg /= g.notes.length;
        var instId = pickInstrument(g.program, avg, melIdx++);
        var ci = addCh(Synth.INSTRUMENT_MAP[instId] ? Synth.INSTRUMENT_MAP[instId].name : 'Voice', instId);
        g.notes.forEach(function (n) {
          patternNotes[ci].push({ t: qStep(n.tick), dur: qDur(n.durTicks), midi: fold(n.midi), vel: vel(n.vel) });
        });
      }
    });

    // Pattern length to fit the whole performance.
    var totalSteps = 0;
    patternNotes.forEach(function (arr) { arr.forEach(function (n) { totalSteps = Math.max(totalSteps, n.t + n.dur); }); });
    var stepsPerBar = spb * beatsPerBar;
    var bars = Math.max(1, Math.ceil(totalSteps / stepsPerBar));

    return Song.deserialize({
      v: 1,
      title: opts.title || parsed.name || 'Imported MIDI',
      bpm: bpm, stepsPerBeat: spb, beatsPerBar: beatsPerBar, barsPerPattern: bars,
      rootPc: 0, scale: 'chromatic',
      channels: channels.length ? channels : [{ name: 'Voice', instId: 'pulse25', volume: 0.8, color: colors[0] }],
      patterns: [{ name: 'Imported', notes: patternNotes.length ? patternNotes : [[]] }],
      sequence: [0]
    });
  }

  global.BBB.Midi = { parse: parse, toSong: toSong };
})(window);
