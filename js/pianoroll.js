/* ============================================================================
 * 8BitBeatBox — pianoroll.js
 * Canvas piano-roll editor.
 *   • Static grid + notes are drawn once to an offscreen "layer" and blitted
 *     each frame, so the animated playhead stays smooth and cheap.
 *   • Drawing: click or DRAG to paint a run of notes (rolling scales). Notes
 *     snap to the chosen length and to the scale.
 *   • Drag a note body to move, its right edge to resize; right-drag / alt-click
 *     to erase.
 * ========================================================================== */
(function (global) {
  'use strict';

  var Song = global.BBB.Song;
  var Synth = global.BBB.Synth;

  var GUTTER = 58;
  var RULER = 28;
  var HIGH = 96;     // top MIDI note
  var LOW = 24;      // bottom MIDI note
  var NOTE_H = 15;
  var BLACK = { 1: 1, 3: 1, 6: 1, 8: 1, 10: 1 };

  function hexToRgb(h) {
    h = h.replace('#', '');
    return [parseInt(h.substr(0, 2), 16), parseInt(h.substr(2, 2), 16), parseInt(h.substr(4, 2), 16)];
  }
  function mix(rgb, target, amt) {
    return 'rgb(' +
      Math.round(rgb[0] + (target - rgb[0]) * amt) + ',' +
      Math.round(rgb[1] + (target - rgb[1]) * amt) + ',' +
      Math.round(rgb[2] + (target - rgb[2]) * amt) + ')';
  }

  var PianoRoll = {
    app: null, canvas: null, ctx: null, container: null,
    layer: null, lctx: null,
    stepW: 26, dpr: 1,
    playStep: -1, playPattern: -1,
    _drag: null, _painted: null, _lastPreview: null, _raf: null,

    init: function (canvas, container, app) {
      this.canvas = canvas;
      this.ctx = canvas.getContext('2d');
      this.container = container;
      this.app = app;
      this.layer = document.createElement('canvas');
      this.lctx = this.layer.getContext('2d');
      var self = this;
      canvas.addEventListener('mousedown', function (e) { self._onDown(e); });
      window.addEventListener('mousemove', function (e) { self._onMove(e); });
      window.addEventListener('mouseup', function () { self._onUp(); });
      canvas.addEventListener('contextmenu', function (e) { e.preventDefault(); });
      container.addEventListener('scroll', function () { self.render(); });
      this.resize();
      container.scrollTop = this._rowY(72) - 90;
    },

    setZoom: function (w) { this.stepW = w; this.resize(); },

    // Rebuild the static layer (grid + notes) and repaint. Call after any edit
    // that changes notes, the active channel, the scale/key, or the pattern.
    refresh: function () { this.rebuild(); this.render(); },

    _dims: function () {
      var steps = Song.patternSteps(this.app.song);
      var rows = HIGH - LOW + 1;
      return { steps: steps, rows: rows, W: GUTTER + steps * this.stepW, H: RULER + rows * NOTE_H };
    },

    resize: function () {
      var d = this._dims();
      this.dpr = global.devicePixelRatio || 1;
      [this.canvas, this.layer].forEach(function (c) {
        c.width = d.W * this.dpr; c.height = d.H * this.dpr;
      }, this);
      this.canvas.style.width = d.W + 'px';
      this.canvas.style.height = d.H + 'px';
      this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
      this.lctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
      this.rebuild();
      this.render();
    },

    // ---- coordinates ----
    _stepX: function (s) { return GUTTER + s * this.stepW; },
    _rowY: function (m) { return RULER + (HIGH - m) * NOTE_H; },
    _stepAt: function (x) { return Math.floor((x - GUTTER) / this.stepW); },
    _midiAt: function (y) { return HIGH - Math.floor((y - RULER) / NOTE_H); },

    _snap: function (m) {
      var s = this.app.song;
      if (!this.app.snapToScale || s.scale === 'chromatic') return m;
      for (var d = 0; d <= 6; d++) {
        if (Song.isInScale(m - d, s.rootPc, s.scale)) return m - d;
        if (Song.isInScale(m + d, s.rootPc, s.scale)) return m + d;
      }
      return m;
    },

    // ===================  STATIC LAYER  =================================
    rebuild: function () {
      var ctx = this.lctx, song = this.app.song, d = this._dims();
      var stepsPerBar = song.stepsPerBeat * song.beatsPerBar;
      ctx.clearRect(0, 0, d.W, d.H);

      // row backgrounds
      for (var m = HIGH; m >= LOW; m--) {
        var y = this._rowY(m);
        var pc = ((m % 12) + 12) % 12;
        var inScale = Song.isInScale(m, song.rootPc, song.scale);
        if (pc === song.rootPc) ctx.fillStyle = '#2a1d45';
        else if (inScale) ctx.fillStyle = BLACK[pc] ? '#191230' : '#1d1636';
        else ctx.fillStyle = BLACK[pc] ? '#0d0a18' : '#120e22';
        ctx.fillRect(GUTTER, y, d.W - GUTTER, NOTE_H);
      }

      // vertical grid
      for (var s = 0; s <= d.steps; s++) {
        var x = this._stepX(s);
        if (s % stepsPerBar === 0) { ctx.strokeStyle = '#4a3d70'; ctx.lineWidth = 2; }
        else if (s % song.stepsPerBeat === 0) { ctx.strokeStyle = '#2c2348'; ctx.lineWidth = 1; }
        else { ctx.strokeStyle = '#160f28'; ctx.lineWidth = 1; }
        ctx.beginPath(); ctx.moveTo(x + 0.5, RULER); ctx.lineTo(x + 0.5, d.H); ctx.stroke();
      }
      // octave lines
      for (var mm = HIGH; mm >= LOW; mm--) {
        if (((mm % 12) + 12) % 12 === 0) {
          var yy = this._rowY(mm) + NOTE_H;
          ctx.strokeStyle = '#241c3e'; ctx.lineWidth = 1;
          ctx.beginPath(); ctx.moveTo(GUTTER, yy + 0.5); ctx.lineTo(d.W, yy + 0.5); ctx.stroke();
        }
      }

      // notes — inactive channels dim, then active bright on top
      var pat = song.patterns[this.app.currentPatternIndex];
      if (pat) {
        for (var ch = 0; ch < song.channels.length; ch++) {
          if (ch === this.app.activeChannel) continue;
          this._drawNotes(ctx, ch, pat.notes[ch], false);
        }
        this._drawNotes(ctx, this.app.activeChannel, pat.notes[this.app.activeChannel], true);
      }
    },

    _drawNotes: function (ctx, ch, notes, active) {
      if (!notes) return;
      var color = this.app.song.channels[ch].color;
      var rgb = hexToRgb(color);
      ctx.globalAlpha = active ? 1 : 0.28;
      for (var i = 0; i < notes.length; i++) {
        var n = notes[i];
        var x = this._stepX(n.t), y = this._rowY(n.midi), w = n.dur * this.stepW;
        var g = ctx.createLinearGradient(0, y, 0, y + NOTE_H);
        g.addColorStop(0, mix(rgb, 255, 0.55));
        g.addColorStop(0.5, color);
        g.addColorStop(1, mix(rgb, 0, 0.25));
        if (active) { ctx.shadowColor = color; ctx.shadowBlur = 9; }
        ctx.fillStyle = g;
        this._round(ctx, x + 1, y + 1, Math.max(3, w - 2), NOTE_H - 2, 3);
        ctx.fill();
        ctx.shadowBlur = 0;
        if (active) {
          ctx.strokeStyle = 'rgba(255,255,255,0.6)'; ctx.lineWidth = 1; ctx.stroke();
          ctx.fillStyle = 'rgba(0,0,0,0.4)';
          ctx.fillRect(x + w - 4, y + 4, 2, NOTE_H - 8);
        }
      }
      ctx.globalAlpha = 1;
    },

    _round: function (ctx, x, y, w, h, r) {
      if (w < 2 * r) r = w / 2;
      ctx.beginPath();
      ctx.moveTo(x + r, y);
      ctx.arcTo(x + w, y, x + w, y + h, r);
      ctx.arcTo(x + w, y + h, x, y + h, r);
      ctx.arcTo(x, y + h, x, y, r);
      ctx.arcTo(x, y, x + w, y, r);
      ctx.closePath();
    },

    // ===================  PER-FRAME RENDER  =============================
    render: function () {
      var ctx = this.ctx, song = this.app.song, d = this._dims();
      var sl = this.container.scrollLeft, st = this.container.scrollTop;
      ctx.clearRect(0, 0, d.W, d.H);
      ctx.drawImage(this.layer, 0, 0, d.W, d.H);

      // playhead (fractional)
      if (this.playStep >= 0 && this.playPattern === this.app.currentPatternIndex) {
        var px = this._stepX(this.playStep);
        var grad = ctx.createLinearGradient(px - 14, 0, px + 6, 0);
        grad.addColorStop(0, 'rgba(58,214,255,0)');
        grad.addColorStop(1, 'rgba(58,214,255,0.22)');
        ctx.fillStyle = grad;
        ctx.fillRect(px - 14, RULER, 20, d.H - RULER);
        ctx.strokeStyle = '#bff4ff'; ctx.lineWidth = 2;
        ctx.shadowColor = '#3ad6ff'; ctx.shadowBlur = 10;
        ctx.beginPath(); ctx.moveTo(px + 0.5, RULER); ctx.lineTo(px + 0.5, d.H); ctx.stroke();
        ctx.shadowBlur = 0;
      }

      this._drawRuler(st, d);
      this._drawGutter(sl, d);
      // corner
      ctx.fillStyle = '#0a0816';
      ctx.fillRect(sl, st, GUTTER, RULER);
      ctx.strokeStyle = '#4a3d70'; ctx.lineWidth = 1;
      ctx.strokeRect(sl + 0.5, st + 0.5, GUTTER, RULER);
    },

    _drawRuler: function (st, d) {
      var ctx = this.ctx, song = this.app.song;
      var stepsPerBar = song.stepsPerBeat * song.beatsPerBar;
      ctx.fillStyle = '#0a0816';
      ctx.fillRect(0, st, d.W, RULER);
      ctx.strokeStyle = '#4a3d70'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(0, st + RULER + 0.5); ctx.lineTo(d.W, st + RULER + 0.5); ctx.stroke();
      ctx.font = '11px "VT323", monospace'; ctx.textBaseline = 'middle';
      for (var b = 0; b * stepsPerBar < d.steps; b++) {
        var bx = this._stepX(b * stepsPerBar);
        ctx.strokeStyle = '#4a3d70';
        ctx.beginPath(); ctx.moveTo(bx + 0.5, st); ctx.lineTo(bx + 0.5, st + RULER); ctx.stroke();
        ctx.fillStyle = '#b7a8e0'; ctx.font = '13px "VT323", monospace';
        ctx.fillText('BAR ' + (b + 1), bx + 6, st + RULER / 2);
      }
    },

    _drawGutter: function (sl, d) {
      var ctx = this.ctx, song = this.app.song;
      ctx.fillStyle = '#0a0816';
      ctx.fillRect(sl, RULER, GUTTER, d.H - RULER);
      ctx.font = '11px "VT323", monospace'; ctx.textBaseline = 'middle';
      for (var m = HIGH; m >= LOW; m--) {
        var y = this._rowY(m), pc = ((m % 12) + 12) % 12, black = BLACK[pc];
        ctx.fillStyle = black ? '#1a1430' : '#d9d2f0';
        ctx.fillRect(sl + 1, y, GUTTER - 2, NOTE_H - 1);
        if (Song.isInScale(m, song.rootPc, song.scale)) {
          ctx.fillStyle = pc === song.rootPc ? '#3ad6ff' : (black ? '#3a2f5c' : '#a99fd6');
          ctx.fillRect(sl + 1, y, 5, NOTE_H - 1);
        }
        if (pc === 0) {
          ctx.fillStyle = '#5a4f80';
          ctx.fillText(Song.noteName(m), sl + 11, y + NOTE_H / 2);
        }
      }
      ctx.strokeStyle = '#4a3d70'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(sl + GUTTER + 0.5, RULER); ctx.lineTo(sl + GUTTER + 0.5, d.H); ctx.stroke();
    },

    // ===================  HIT TESTING  =================================
    _notes: function () { return this.app.song.patterns[this.app.currentPatternIndex].notes[this.app.activeChannel]; },
    _noteAt: function (step, midi, x) {
      var notes = this._notes();
      for (var i = notes.length - 1; i >= 0; i--) {
        var n = notes[i];
        if (n.midi === midi && step >= n.t && step < n.t + n.dur) {
          return { note: n, index: i, onGrip: x >= this._stepX(n.t + n.dur) - 7 };
        }
      }
      return null;
    },

    // ===================  MOUSE  ======================================
    _evt: function (e) {
      var r = this.canvas.getBoundingClientRect();
      return { x: e.clientX - r.left, y: e.clientY - r.top };
    },

    _onDown: function (e) {
      var p = this._evt(e);
      var sl = this.container.scrollLeft, st = this.container.scrollTop;

      // piano-key audition in the pinned gutter
      if (p.x - sl < GUTTER && p.y - st > RULER) {
        var pm = this._midiAt(p.y);
        if (pm <= HIGH && pm >= LOW) Synth.preview(this.app.song.channels[this.app.activeChannel].instId, pm, 0.4);
        return;
      }
      if (p.y - st < RULER) return;

      var step = this._stepAt(p.x), midi = this._midiAt(p.y);
      if (step < 0 || midi > HIGH || midi < LOW) return;

      if (e.button === 2) { this._drag = { mode: 'erase' }; this._eraseAt(step, midi, p.x); return; }

      var hit = this._noteAt(step, midi, p.x);
      if (hit) {
        if (e.altKey) { this._deleteIndex(hit.index); return; }
        this._drag = hit.onGrip
          ? { mode: 'resize', note: hit.note }
          : { mode: 'move', note: hit.note, gs: step - hit.note.t, gm: midi - hit.note.midi };
        this.app.selectedNote = hit.note;
        this.rebuild(); this.render();
      } else {
        this._drag = { mode: 'paint' };
        this._painted = {};
        this._paintAt(step, midi);
      }
    },

    _onMove: function (e) {
      if (!this._drag) return;
      var p = this._evt(e);
      var step = this._stepAt(p.x), midi = this._midiAt(p.y);
      var maxSteps = Song.patternSteps(this.app.song);
      var dr = this._drag;

      if (dr.mode === 'paint') {
        this._paintAt(step, midi);
      } else if (dr.mode === 'erase') {
        this._eraseAt(step, midi, p.x);
      } else if (dr.mode === 'resize') {
        dr.note.dur = Math.max(1, Math.min(maxSteps - dr.note.t, step - dr.note.t + 1));
        this.rebuild(); this.render();
      } else if (dr.mode === 'move') {
        var nt = Math.max(0, Math.min(maxSteps - dr.note.dur, step - dr.gs));
        var nm = this._snap(Math.max(LOW, Math.min(HIGH, midi - dr.gm)));
        dr.note.t = nt;
        if (nm !== dr.note.midi) { dr.note.midi = nm; this._preview(nm); }
        this.rebuild(); this.render();
      }
    },

    _onUp: function () {
      if (!this._drag) return;
      this._drag = null; this._painted = null; this._lastPreview = null;
      this.app.onEdit();
    },

    _paintAt: function (step, midi) {
      var L = this.app.noteLen || 2;
      var maxSteps = Song.patternSteps(this.app.song);
      var slot = Math.floor(step / L) * L;
      if (slot < 0 || slot >= maxSteps) return;
      if (this._painted[slot]) return;
      this._painted[slot] = true;
      var m = this._snap(Math.max(LOW, Math.min(HIGH, midi)));
      var notes = this._notes();
      // avoid exact duplicate
      for (var i = 0; i < notes.length; i++) if (notes[i].t === slot && notes[i].midi === m) return;
      notes.push({ t: slot, dur: Math.min(L, maxSteps - slot), midi: m, vel: 1 });
      this._preview(m);
      this.rebuild(); this.render();
    },

    _eraseAt: function (step, midi, x) {
      var hit = this._noteAt(step, midi, x);
      if (hit) { this._notes().splice(hit.index, 1); this.rebuild(); this.render(); }
    },

    _deleteIndex: function (i) {
      this._notes().splice(i, 1);
      this.app.selectedNote = null;
      this.rebuild(); this.render(); this.app.onEdit();
    },

    _preview: function (m) {
      if (this._lastPreview === m) return;
      this._lastPreview = m;
      Synth.preview(this.app.song.channels[this.app.activeChannel].instId, m, 0.25);
    },

    // ===================  PLAYHEAD ANIMATION  =========================
    startPlayhead: function () {
      if (this._raf) return;
      var self = this;
      (function loop() {
        var seq = global.BBB.Sequencer;
        if (!seq.isPlaying) { self._raf = null; self.playStep = -1; self.render(); return; }
        var pos = seq.getPosition();
        if (pos) {
          if (self.app.playMode === 'song' && pos.patternIndex !== self.app.currentPatternIndex) {
            self.app.setPattern(pos.patternIndex);
          }
          self.playStep = pos.localStep;
          self.playPattern = pos.patternIndex;
          self.render();
          self._follow(pos.localStep);
        }
        self._raf = requestAnimationFrame(loop);
      })();
    },

    stopPlayhead: function () {
      this.playStep = -1;
      if (this._raf) { cancelAnimationFrame(this._raf); this._raf = null; }
      this.render();
    },

    _follow: function (step) {
      var px = this._stepX(step);
      var view = this.container.scrollLeft, vw = this.container.clientWidth;
      if (px > view + vw - 80 || px < view + GUTTER) {
        this.container.scrollLeft = px - GUTTER - 40;
      }
    }
  };

  global.BBB.PianoRoll = PianoRoll;
})(window);
