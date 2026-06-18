/* ============================================================================
 * 8BitBeatBox — sequencer.js
 * Sample-accurate playback using the Web Audio clock with a lookahead
 * scheduler (the classic "Tale of Two Clocks" pattern). Also owns the offline
 * WAV renderer, which reuses the same note-walking logic.
 * ========================================================================== */
(function (global) {
  'use strict';

  var Song = global.BBB.Song;
  var Synth = global.BBB.Synth;

  function secondsPerStep(song) {
    return 60 / song.bpm / song.stepsPerBeat;
  }

  // Channels that should sound, accounting for solo/mute.
  function audibleChannels(song) {
    var anySolo = song.channels.some(function (c) { return c.solo; });
    return song.channels.map(function (c) {
      return anySolo ? c.solo : !c.mute;
    });
  }

  var Sequencer = {
    app: null,
    isPlaying: false,
    lookahead: 25,        // ms between scheduler ticks
    scheduleAhead: 0.12,  // seconds of audio scheduled in advance
    _timer: null,
    _nextNoteTime: 0,
    _absStep: 0,          // absolute step counter across the played span
    _startTime: 0,
    _seqList: null,       // flat list of pattern indices being played
    _stepsPerPattern: 0,
    onStep: null,         // callback(localStep, patternIndex)

    init: function (app) { this.app = app; },

    _buildSeqList: function () {
      var app = this.app, song = app.song;
      if (app.playMode === 'song') {
        this._seqList = song.sequence.slice();
        if (!this._seqList.length) this._seqList = [app.currentPatternIndex];
      } else {
        this._seqList = [app.currentPatternIndex];
      }
      this._stepsPerPattern = Song.patternSteps(song);
    },

    start: function () {
      if (this.isPlaying) return;
      var ctx = Synth.ensure();
      this.isPlaying = true;
      this._buildSeqList();
      this._absStep = 0;
      this._nextNoteTime = ctx.currentTime + 0.06;
      this._startTime = this._nextNoteTime;
      var self = this;
      this._timer = setInterval(function () { self._scheduler(); }, this.lookahead);
      this._scheduler();
    },

    stop: function () {
      this.isPlaying = false;
      if (this._timer) { clearInterval(this._timer); this._timer = null; }
      if (this.onStep) this.onStep(-1, this.app.currentPatternIndex);
    },

    toggle: function () { this.isPlaying ? this.stop() : this.start(); },

    _scheduler: function () {
      var ctx = Synth.ctx;
      var song = this.app.song;
      var sps = secondsPerStep(song);
      while (this._nextNoteTime < ctx.currentTime + this.scheduleAhead) {
        this._scheduleStep(this._absStep, this._nextNoteTime);
        this._nextNoteTime += sps;
        this._absStep++;
      }
    },

    _scheduleStep: function (absStep, time) {
      var song = this.app.song;
      var total = this._stepsPerPattern * this._seqList.length;
      if (total === 0) return;

      // Handle end-of-span: loop pattern, or stop at song end (loop song too).
      var pos = absStep % total;
      var seqIdx = Math.floor(pos / this._stepsPerPattern);
      var localStep = pos % this._stepsPerPattern;
      var patternIndex = this._seqList[seqIdx];
      var pattern = song.patterns[patternIndex];
      if (!pattern) return;

      var audible = audibleChannels(song);
      var sps = secondsPerStep(song);

      for (var ch = 0; ch < song.channels.length; ch++) {
        if (!audible[ch]) continue;
        var channel = song.channels[ch];
        var inst = Synth.INSTRUMENT_MAP[channel.instId];
        if (!inst) continue;
        var notes = pattern.notes[ch];
        if (!notes) continue;
        for (var n = 0; n < notes.length; n++) {
          var note = notes[n];
          if (note.t !== localStep) continue;
          Synth.createVoice(Synth.ctx, inst, {
            freq: Synth.midiToFreq(note.midi),
            midi: note.midi,
            time: time,
            duration: note.dur * sps,
            velocity: (note.vel == null ? 1 : note.vel) * channel.volume,
            destination: Synth.master
          });
        }
      }

    },

    // Clock-driven position for the smooth playhead (queried each frame).
    getPosition: function () {
      if (!this.isPlaying || !Synth.ctx) return null;
      var sps = secondsPerStep(this.app.song);
      var total = this._stepsPerPattern * this._seqList.length;
      if (total === 0) return null;
      var elapsed = Synth.ctx.currentTime - this._startTime;
      if (elapsed < 0) elapsed = 0;
      var posF = (elapsed / sps) % total;
      var seqIdx = Math.floor(posF / this._stepsPerPattern);
      var localStep = posF - seqIdx * this._stepsPerPattern;
      return { patternIndex: this._seqList[seqIdx], localStep: localStep };
    },

    // ---- Offline WAV render ------------------------------------------------
    renderWav: function () {
      var app = this.app, song = app.song;
      var seqList = app.playMode === 'song'
        ? (song.sequence.length ? song.sequence.slice() : [app.currentPatternIndex])
        : [app.currentPatternIndex];
      var stepsPer = Song.patternSteps(song);
      var totalSteps = stepsPer * seqList.length;
      var sps = secondsPerStep(song);
      var tail = 1.0; // seconds of release tail
      var duration = totalSteps * sps + tail;
      var sampleRate = 44100;

      var OAC = global.OfflineAudioContext || global.webkitOfflineAudioContext;
      var octx = new OAC(2, Math.ceil(duration * sampleRate), sampleRate);
      var master = octx.createGain();
      master.gain.value = (Synth.master ? Synth.master.gain.value : 0.8);
      master.connect(octx.destination);

      var audible = audibleChannels(song);
      for (var s = 0; s < seqList.length; s++) {
        var pattern = song.patterns[seqList[s]];
        if (!pattern) continue;
        var baseStep = s * stepsPer;
        for (var ch = 0; ch < song.channels.length; ch++) {
          if (!audible[ch]) continue;
          var channel = song.channels[ch];
          var inst = Synth.INSTRUMENT_MAP[channel.instId];
          if (!inst) continue;
          var notes = pattern.notes[ch] || [];
          for (var n = 0; n < notes.length; n++) {
            var note = notes[n];
            var t = (baseStep + note.t) * sps + 0.02;
            Synth.createVoice(octx, inst, {
              freq: Synth.midiToFreq(note.midi),
              midi: note.midi,
              time: t,
              duration: note.dur * sps,
              velocity: (note.vel == null ? 1 : note.vel) * channel.volume,
              destination: master
            });
          }
        }
      }

      return octx.startRendering().then(function (buffer) {
        return encodeWav(buffer);
      });
    }
  };

  // Encode an AudioBuffer to a 16-bit PCM WAV Blob.
  function encodeWav(buffer) {
    var numCh = buffer.numberOfChannels;
    var len = buffer.length;
    var sampleRate = buffer.sampleRate;
    var bytesPerSample = 2;
    var blockAlign = numCh * bytesPerSample;
    var dataSize = len * blockAlign;
    var ab = new ArrayBuffer(44 + dataSize);
    var view = new DataView(ab);

    function writeStr(off, str) {
      for (var i = 0; i < str.length; i++) view.setUint8(off + i, str.charCodeAt(i));
    }
    writeStr(0, 'RIFF');
    view.setUint32(4, 36 + dataSize, true);
    writeStr(8, 'WAVE');
    writeStr(12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);            // PCM
    view.setUint16(22, numCh, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * blockAlign, true);
    view.setUint16(32, blockAlign, true);
    view.setUint16(34, 16, true);
    writeStr(36, 'data');
    view.setUint32(40, dataSize, true);

    var channels = [];
    for (var c = 0; c < numCh; c++) channels.push(buffer.getChannelData(c));
    var offset = 44;
    for (var i = 0; i < len; i++) {
      for (var ch = 0; ch < numCh; ch++) {
        var sample = Math.max(-1, Math.min(1, channels[ch][i]));
        view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7FFF, true);
        offset += 2;
      }
    }
    return new Blob([ab], { type: 'audio/wav' });
  }

  global.BBB.Sequencer = Sequencer;
})(window);
