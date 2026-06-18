/* ============================================================================
 * 8BitBeatBox — library.js
 * A personal song library persisted in localStorage. "Save" stores the current
 * song here (keyed by title, so re-saving updates the same slot); the Songs
 * browser lists them for one-click loading.
 * ========================================================================== */
(function (global) {
  'use strict';

  var KEY = 'bbb_library_v1';
  var Song = global.BBB.Song;

  function read() {
    try { return JSON.parse(localStorage.getItem(KEY) || '[]'); }
    catch (e) { return []; }
  }
  function write(arr) {
    try { localStorage.setItem(KEY, JSON.stringify(arr)); } catch (e) {}
  }

  var Library = {
    // Newest first.
    list: function () {
      return read().sort(function (a, b) { return b.savedAt - a.savedAt; });
    },

    // Save the song. If an entry with the same (case-insensitive) title exists,
    // it is overwritten; otherwise a new entry is appended.
    save: function (song) {
      var arr = read();
      var name = song.title || 'Untitled';
      var data = Song.serialize(song);
      var now = Date.now();
      var existing = arr.filter(function (e) { return e.name.toLowerCase() === name.toLowerCase(); })[0];
      if (existing) { existing.data = data; existing.savedAt = now; }
      else arr.push({ id: 'lib_' + now + '_' + Math.floor(Math.random() * 1e4), name: name, data: data, savedAt: now });
      write(arr);
      return existing || arr[arr.length - 1];
    },

    get: function (id) {
      return read().filter(function (e) { return e.id === id; })[0] || null;
    },

    load: function (id) {
      var e = this.get(id);
      return e ? Song.deserialize(e.data) : null;
    },

    remove: function (id) {
      write(read().filter(function (e) { return e.id !== id; }));
    },

    rename: function (id, name) {
      var arr = read();
      arr.forEach(function (e) { if (e.id === id) e.name = name; });
      write(arr);
    }
  };

  global.BBB.Library = Library;
})(window);
