/* ============================================================================
 * 8BitBeatBox — ui.js
 * Builds the dynamic chrome: the channel rack, the pattern list, and the song
 * arrangement (sequence) bar. Pure DOM; talks back to the app via callbacks.
 * ========================================================================== */
(function (global) {
  'use strict';

  var Song = global.BBB.Song;
  var Synth = global.BBB.Synth;

  function el(tag, cls, txt) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (txt != null) e.textContent = txt;
    return e;
  }

  function instrumentSelect(currentId) {
    var sel = el('select', 'inst-select');
    var groups = {};
    Synth.INSTRUMENTS.forEach(function (inst) {
      if (!groups[inst.group]) {
        var og = el('optgroup');
        og.label = inst.group;
        groups[inst.group] = og;
        sel.appendChild(og);
      }
      var opt = el('option', null, inst.name);
      opt.value = inst.id;
      if (inst.id === currentId) opt.selected = true;
      groups[inst.group].appendChild(opt);
    });
    return sel;
  }

  var UI = {
    app: null,
    init: function (app) { this.app = app; },

    renderAll: function () {
      this.renderChannels();
      this.renderPatterns();
      this.renderSequence();
    },

    // ---- Channel rack ----
    renderChannels: function () {
      var app = this.app, song = app.song;
      var rack = document.getElementById('channel-rack');
      rack.innerHTML = '';

      song.channels.forEach(function (ch, idx) {
        var row = el('div', 'channel' + (idx === app.activeChannel ? ' active' : ''));
        row.style.setProperty('--ch-color', ch.color);

        row.addEventListener('mousedown', function (e) {
          if (e.target.closest('input, select, button')) return;
          app.setActiveChannel(idx);
        });

        var info = el('div', 'channel-info');
        var nameIn = el('input', 'channel-name');
        nameIn.value = ch.name;
        nameIn.addEventListener('change', function () { ch.name = nameIn.value; app.onEdit(); });
        info.appendChild(nameIn);

        var sel = instrumentSelect(ch.instId);
        sel.addEventListener('change', function () {
          ch.instId = sel.value;
          var inst = Synth.INSTRUMENT_MAP[sel.value];
          Synth.preview(sel.value, 72, 0.3);
          app.onEdit();
        });
        info.appendChild(sel);
        row.appendChild(info);

        var ctrls = el('div', 'channel-ctrls');

        var vol = el('input', 'vol');
        vol.type = 'range'; vol.min = 0; vol.max = 1; vol.step = 0.01; vol.value = ch.volume;
        vol.title = 'Channel volume';
        vol.addEventListener('input', function () { ch.volume = parseFloat(vol.value); app.onEdit(); });
        ctrls.appendChild(vol);

        var mBtn = el('button', 'mini' + (ch.mute ? ' on' : ''), 'M');
        mBtn.title = 'Mute';
        mBtn.addEventListener('click', function () { ch.mute = !ch.mute; UI.renderChannels(); app.onEdit(); });
        ctrls.appendChild(mBtn);

        var sBtn = el('button', 'mini solo' + (ch.solo ? ' on' : ''), 'S');
        sBtn.title = 'Solo';
        sBtn.addEventListener('click', function () { ch.solo = !ch.solo; UI.renderChannels(); app.onEdit(); });
        ctrls.appendChild(sBtn);

        var dBtn = el('button', 'mini del', '✕');
        dBtn.title = 'Delete channel';
        dBtn.addEventListener('click', function () {
          if (song.channels.length <= 1) return;
          Song.removeChannel(song, idx);
          if (app.activeChannel >= song.channels.length) app.activeChannel = song.channels.length - 1;
          UI.renderChannels();
          global.BBB.PianoRoll.refresh();
          app.onEdit();
        });
        ctrls.appendChild(dBtn);

        row.appendChild(ctrls);
        rack.appendChild(row);
      });

      var add = el('button', 'add-channel', '+ Add Channel');
      add.addEventListener('click', function () {
        if (song.channels.length >= 8) return;
        Song.addChannel(song, 'pulse50');
        UI.renderChannels();
        global.BBB.PianoRoll.render();
        app.onEdit();
      });
      rack.appendChild(add);
    },

    // ---- Pattern list ----
    renderPatterns: function () {
      var app = this.app, song = app.song;
      var bar = document.getElementById('pattern-list');
      bar.innerHTML = '';
      song.patterns.forEach(function (p, idx) {
        var chip = el('button', 'pattern-chip' + (idx === app.currentPatternIndex ? ' active' : ''), p.name);
        chip.addEventListener('click', function () { app.setPattern(idx); });
        chip.addEventListener('dblclick', function () {
          var nn = prompt('Rename pattern', p.name);
          if (nn) { p.name = nn; UI.renderPatterns(); UI.renderSequence(); app.onEdit(); }
        });
        bar.appendChild(chip);
      });
    },

    // ---- Song arrangement ----
    renderSequence: function () {
      var app = this.app, song = app.song;
      var bar = document.getElementById('sequence-list');
      bar.innerHTML = '';
      song.sequence.forEach(function (patIdx, i) {
        var pat = song.patterns[patIdx];
        var chip = el('div', 'seq-chip');
        chip.style.borderColor = '#46557a';
        chip.appendChild(el('span', 'seq-num', (i + 1) + ''));
        var sel = el('select', 'seq-select');
        song.patterns.forEach(function (p, pi) {
          var o = el('option', null, p.name);
          o.value = pi;
          if (pi === patIdx) o.selected = true;
          sel.appendChild(o);
        });
        sel.addEventListener('change', function () { song.sequence[i] = parseInt(sel.value, 10); app.onEdit(); });
        chip.appendChild(sel);
        var rm = el('button', 'mini del', '✕');
        rm.addEventListener('click', function () {
          if (song.sequence.length <= 1) return;
          song.sequence.splice(i, 1); UI.renderSequence(); app.onEdit();
        });
        chip.appendChild(rm);
        bar.appendChild(chip);
      });
      var add = el('button', 'seq-add', '+');
      add.title = 'Append current pattern to the song';
      add.addEventListener('click', function () {
        song.sequence.push(app.currentPatternIndex);
        UI.renderSequence(); app.onEdit();
      });
      bar.appendChild(add);
    },

    // ---- Songs browser (demos + saved library) ----
    openLibrary: function () {
      this.renderLibraryModal();
      document.getElementById('modal-overlay').hidden = false;
    },
    closeLibrary: function () {
      document.getElementById('modal-overlay').hidden = true;
    },

    _fmtDate: function (ts) {
      var d = new Date(ts);
      return d.toLocaleDateString() + ' ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    },

    _songCard: function (name, desc, onLoad, extraButtons) {
      var card = el('div', 'song-card');
      var main = el('div', 'song-card-main');
      main.appendChild(el('div', 'song-name', name));
      main.appendChild(el('div', 'song-desc', desc));
      main.addEventListener('click', onLoad);
      card.appendChild(main);
      var acts = el('div', 'song-card-actions');
      var load = el('button', 'btn tiny accent', '▶ Load');
      load.addEventListener('click', onLoad);
      acts.appendChild(load);
      (extraButtons || []).forEach(function (b) { acts.appendChild(b); });
      card.appendChild(acts);
      return card;
    },

    renderLibraryModal: function () {
      var App = global.BBB.App, Demo = global.BBB.Demo, Lib = global.BBB.Library;

      var dl = document.getElementById('demo-list');
      dl.innerHTML = '';
      Demo.DEMOS.forEach(function (d) {
        dl.appendChild(UI._songCard(d.name, d.desc, function () { App.loadSongChecked(d.build()); }));
      });

      var ll = document.getElementById('library-list');
      ll.innerHTML = '';
      var items = Lib.list();
      var count = document.getElementById('lib-count');
      if (count) count.textContent = items.length ? '(' + items.length + ')' : '';
      if (!items.length) {
        ll.appendChild(el('div', 'empty-note', 'No saved songs yet — press “Save” in the top bar to store the current song here.'));
        return;
      }
      items.forEach(function (e) {
        var del = el('button', 'mini del', '✕'); del.title = 'Delete';
        del.addEventListener('click', function (ev) {
          ev.stopPropagation();
          if (confirm('Delete “' + e.name + '”?')) { Lib.remove(e.id); UI.renderLibraryModal(); }
        });
        var ren = el('button', 'mini', '✎'); ren.title = 'Rename';
        ren.addEventListener('click', function (ev) {
          ev.stopPropagation();
          var nn = prompt('Rename song', e.name);
          if (nn) { Lib.rename(e.id, nn); UI.renderLibraryModal(); }
        });
        var exp = el('button', 'mini', '⤒'); exp.title = 'Export .json';
        exp.addEventListener('click', function (ev) {
          ev.stopPropagation();
          App.downloadData(e.data, e.name);
        });
        ll.appendChild(UI._songCard(e.name, 'Saved ' + UI._fmtDate(e.savedAt), function () {
          App.loadSongChecked(Lib.load(e.id));
        }, [ren, exp, del]));
      });
    }
  };

  global.BBB.UI = UI;
})(window);
