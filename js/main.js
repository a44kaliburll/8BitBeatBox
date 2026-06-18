/* ============================================================================
 * 8BitBeatBox — main.js
 * Application state + wiring: the current Song, active channel/pattern,
 * transport, global settings, undo/redo history, and file save/load/export.
 * ========================================================================== */
(function (global) {
  'use strict';

  var Song = global.BBB.Song;
  var Synth = global.BBB.Synth;
  var Sequencer = global.BBB.Sequencer;
  var PianoRoll = global.BBB.PianoRoll;
  var UI = global.BBB.UI;
  var Demo = global.BBB.Demo;
  var Library = global.BBB.Library;

  var AUTOSAVE_KEY = 'bbb_autosave_v1';
  var HISTORY_CAP = 80;

  var App = {
    song: null,
    currentPatternIndex: 0,
    activeChannel: 0,
    playMode: 'pattern',
    snapToScale: true,
    noteLen: 2,
    selectedNote: null,
    _commitTimer: null,
    _history: [],
    _histPos: -1,
    _applying: false,

    init: function () {
      var saved = null;
      try {
        var raw = localStorage.getItem(AUTOSAVE_KEY);
        if (raw) saved = Song.deserialize(raw);
      } catch (e) {}
      // First-ever launch → greet the user with the demo song.
      this.song = saved || (Demo ? Demo.createDemoSong() : Song.createDefaultSong());

      PianoRoll.init(document.getElementById('roll'), document.getElementById('roll-wrap'), this);
      UI.init(this);
      Sequencer.init(this);

      this._wireControls();
      this._syncControlsFromSong();
      UI.renderAll();
      PianoRoll.refresh();
      this._resetHistory();
    },

    setActiveChannel: function (idx) {
      this.activeChannel = idx;
      UI.renderChannels();
      PianoRoll.refresh();
    },

    setPattern: function (idx) {
      this.currentPatternIndex = idx;
      UI.renderPatterns();
      PianoRoll.refresh();
    },

    onEdit: function () {
      if (this._applying) return;
      UI.renderPatterns();
      UI.renderSequence();
      this._scheduleCommit();
    },

    // ---- History / autosave (debounced so drags collapse into one step) ----
    _scheduleCommit: function () {
      var self = this;
      clearTimeout(this._commitTimer);
      this._commitTimer = setTimeout(function () { self._commit(); }, 400);
    },
    _commit: function () {
      var str = Song.serialize(this.song);
      if (str !== this._history[this._histPos]) {
        this._history = this._history.slice(0, this._histPos + 1);
        this._history.push(str);
        if (this._history.length > HISTORY_CAP) this._history.shift();
        this._histPos = this._history.length - 1;
      }
      try { localStorage.setItem(AUTOSAVE_KEY, str); } catch (e) {}
    },
    _resetHistory: function () {
      this._history = [Song.serialize(this.song)];
      this._histPos = 0;
    },
    undo: function () { if (this._histPos > 0) { this._histPos--; this._applyState(this._history[this._histPos]); } },
    redo: function () { if (this._histPos < this._history.length - 1) { this._histPos++; this._applyState(this._history[this._histPos]); } },
    _applyState: function (str) {
      this._applying = true;
      this.song = Song.deserialize(str);
      this.currentPatternIndex = Math.min(this.currentPatternIndex, this.song.patterns.length - 1);
      this.activeChannel = Math.min(this.activeChannel, this.song.channels.length - 1);
      this._syncControlsFromSong();
      UI.renderAll();
      PianoRoll.resize();
      try { localStorage.setItem(AUTOSAVE_KEY, str); } catch (e) {}
      this._applying = false;
    },

    // ---- Controls ----
    _wireControls: function () {
      var self = this;
      function on(id, evt, fn) { var e = document.getElementById(id); if (e) e.addEventListener(evt, fn); }
      function refreshDims() { PianoRoll.resize(); self.onEdit(); }

      on('btn-play', 'click', function () { self._togglePlay(); });
      on('btn-stop', 'click', function () { Sequencer.stop(); PianoRoll.stopPlayhead(); self._setPlayBtn(false); });

      on('title', 'input', function (e) { self.song.title = e.target.value; self.onEdit(); });
      on('bpm', 'input', function (e) { var v = parseInt(e.target.value, 10); if (v >= 20 && v <= 400) { self.song.bpm = v; self.onEdit(); } });
      on('grid', 'change', function (e) { self.song.stepsPerBeat = parseInt(e.target.value, 10); refreshDims(); });
      on('beats', 'change', function (e) { self.song.beatsPerBar = parseInt(e.target.value, 10); refreshDims(); });
      on('bars', 'input', function (e) { var v = parseInt(e.target.value, 10); if (v >= 1 && v <= 16) { self.song.barsPerPattern = v; refreshDims(); } });
      on('key', 'change', function (e) { self.song.rootPc = parseInt(e.target.value, 10); PianoRoll.refresh(); self.onEdit(); });
      on('scale', 'change', function (e) { self.song.scale = e.target.value; PianoRoll.refresh(); self.onEdit(); });
      on('notelen', 'change', function (e) { self.noteLen = parseInt(e.target.value, 10); });
      on('snap', 'change', function (e) { self.snapToScale = e.target.checked; });
      on('master', 'input', function (e) { Synth.ensure(); Synth.setMasterVolume(parseFloat(e.target.value)); });
      on('zoom', 'input', function (e) { PianoRoll.setZoom(parseInt(e.target.value, 10)); });
      on('mode', 'change', function (e) { self.playMode = e.target.value; });

      on('btn-undo', 'click', function () { self.undo(); });
      on('btn-redo', 'click', function () { self.redo(); });

      on('btn-add-pattern', 'click', function () { self.setPattern(Song.addPattern(self.song)); UI.renderSequence(); self.onEdit(); });
      on('btn-dup-pattern', 'click', function () { self.setPattern(Song.addPattern(self.song, self.currentPatternIndex)); UI.renderSequence(); self.onEdit(); });
      on('btn-clear-pattern', 'click', function () {
        self.song.patterns[self.currentPatternIndex].notes = self.song.channels.map(function () { return []; });
        PianoRoll.refresh(); self.onEdit();
      });
      on('btn-del-pattern', 'click', function () {
        var song = self.song;
        if (song.patterns.length <= 1) return;
        song.patterns.splice(self.currentPatternIndex, 1);
        song.sequence = song.sequence
          .map(function (i) { return i > self.currentPatternIndex ? i - 1 : i; })
          .filter(function (i) { return i < song.patterns.length; });
        if (!song.sequence.length) song.sequence = [0];
        self.currentPatternIndex = Math.max(0, self.currentPatternIndex - 1);
        UI.renderAll(); PianoRoll.refresh(); self.onEdit();
      });

      on('btn-songs', 'click', function () { UI.openLibrary(); });
      on('modal-close', 'click', function () { UI.closeLibrary(); });
      on('modal-overlay', 'click', function (e) { if (e.target.id === 'modal-overlay') UI.closeLibrary(); });
      on('btn-new', 'click', function () { self.loadSongChecked(Song.createDefaultSong()); });
      on('btn-import', 'click', function () { document.getElementById('file-input').click(); });
      on('file-input', 'change', function (e) { self._loadFile(e.target.files[0]); e.target.value = ''; });
      on('btn-save', 'click', function () { self._saveToLibrary(); });
      on('btn-export', 'click', function () { self._exportWav(); });

      window.addEventListener('keydown', function (e) {
        var typing = /input|select|textarea/i.test(document.activeElement.tagName);
        if (e.key === 'Escape') { UI.closeLibrary(); return; }
        if (e.code === 'Space' && !typing) { e.preventDefault(); self._togglePlay(); return; }
        if ((e.ctrlKey || e.metaKey) && !typing) {
          if (e.key === 'z' && !e.shiftKey) { e.preventDefault(); self.undo(); }
          else if (e.key === 'y' || (e.key === 'z' && e.shiftKey)) { e.preventDefault(); self.redo(); }
        }
      });
    },

    // Load a song after a replace-confirmation, and close the browser.
    loadSongChecked: function (song) {
      if (!song) return;
      if (!this._confirmReplace()) return;
      this._loadSong(song);
      UI.closeLibrary();
    },

    _saveToLibrary: function () {
      var entry = Library.save(this.song);
      var btn = document.getElementById('btn-save');
      if (btn) {
        var prev = btn.textContent;
        btn.textContent = 'Saved ✓';
        btn.classList.add('ok');
        setTimeout(function () { btn.textContent = prev; btn.classList.remove('ok'); }, 1100);
      }
    },

    downloadData: function (data, name) {
      this._download(new Blob([data], { type: 'application/json' }),
        (name || 'chiptune').replace(/[^a-z0-9_-]+/gi, '_') + '.8bb.json');
    },

    _confirmReplace: function () {
      var empty = this.song.patterns.every(function (p) {
        return p.notes.every(function (a) { return a.length === 0; });
      });
      return empty || confirm('Replace the current song? Unsaved changes will be lost.');
    },

    _loadSong: function (song) {
      Sequencer.stop(); PianoRoll.stopPlayhead(); this._setPlayBtn(false);
      this.song = song;
      this.currentPatternIndex = 0; this.activeChannel = 0;
      this._syncControlsFromSong();
      UI.renderAll(); PianoRoll.resize(); this._resetHistory();
      try { localStorage.setItem(AUTOSAVE_KEY, Song.serialize(song)); } catch (e) {}
    },

    _syncControlsFromSong: function () {
      var song = this.song;
      function set(id, v) { var e = document.getElementById(id); if (e) e.value = v; }
      set('title', song.title); set('bpm', song.bpm); set('grid', song.stepsPerBeat);
      set('beats', song.beatsPerBar); set('bars', song.barsPerPattern);
      set('key', song.rootPc); set('scale', song.scale); set('mode', this.playMode);
      set('notelen', this.noteLen);
      var snap = document.getElementById('snap'); if (snap) snap.checked = this.snapToScale;
    },

    _togglePlay: function () {
      Sequencer.toggle();
      if (Sequencer.isPlaying) PianoRoll.startPlayhead();
      else PianoRoll.stopPlayhead();
      this._setPlayBtn(Sequencer.isPlaying);
    },
    _setPlayBtn: function (playing) {
      var b = document.getElementById('btn-play');
      if (b) { b.textContent = playing ? '❚❚ Pause' : '▶ Play'; b.classList.toggle('playing', playing); }
    },

    // ---- Files ----
    _download: function (blob, filename) {
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = url; a.download = filename;
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
    },
    _loadFile: function (file) {
      if (!file) return;
      var self = this, reader = new FileReader();
      reader.onload = function () {
        try { self._loadSong(Song.deserialize(reader.result)); UI.closeLibrary(); }
        catch (err) { alert('Could not load file: ' + err.message); }
      };
      reader.readAsText(file);
    },
    _exportWav: function () {
      var self = this, btn = document.getElementById('btn-export');
      var old = btn ? btn.textContent : '';
      if (btn) { btn.textContent = 'Rendering…'; btn.disabled = true; }
      Synth.ensure();
      Sequencer.renderWav().then(function (blob) {
        self._download(blob, (self.song.title || 'chiptune').replace(/[^a-z0-9_-]+/gi, '_') + '.wav');
        if (btn) { btn.textContent = old; btn.disabled = false; }
      }).catch(function (err) {
        alert('Export failed: ' + err.message);
        if (btn) { btn.textContent = old; btn.disabled = false; }
      });
    }
  };

  global.BBB.App = App;
  document.addEventListener('DOMContentLoaded', function () { App.init(); });
})(window);
