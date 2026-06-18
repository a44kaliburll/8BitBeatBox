/* ============================================================================
 * 8BitBeatBox — crusher.js
 * The "8-bit / 16-bit FX" processor. Loads any WAV/MP3, then degrades it to
 * retro-console character: bit-depth reduction + sample-rate decimation
 * (sample-and-hold aliasing), soft drive, a warm low-pass, and optional
 * SNES-style reverb. Works fully offline (no AudioWorklet) by processing the
 * decoded samples directly, then rendering through an OfflineAudioContext.
 * ========================================================================== */
(function (global) {
  'use strict';

  var Synth = global.BBB.Synth;

  // Synthesize a simple decaying-noise impulse response for the reverb.
  function makeIR(ctx, seconds, decay) {
    var len = Math.floor(ctx.sampleRate * seconds);
    var ir = ctx.createBuffer(2, len, ctx.sampleRate);
    for (var ch = 0; ch < 2; ch++) {
      var d = ir.getChannelData(ch);
      for (var i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
    }
    return ir;
  }

  var Crusher = {
    buffer: null,        // decoded original AudioBuffer
    fileName: '',
    source: null,        // current preview source
    onEnded: null,

    load: function (file) {
      var ctx = Synth.ensure(), self = this;
      return file.arrayBuffer().then(function (ab) {
        return ctx.decodeAudioData(ab);
      }).then(function (buf) {
        self.buffer = buf; self.fileName = file.name; return buf;
      });
    },

    duration: function () { return this.buffer ? this.buffer.duration : 0; },

    // opts: { bits, rate(kHz), lp(kHz), drive, reverb(0..1), mix(0..1) }
    process: function (opts) {
      var orig = this.buffer;
      if (!orig) return Promise.reject(new Error('No audio loaded'));
      var rate = orig.sampleRate, nyq = rate / 2;
      var tail = opts.reverb > 0 ? Math.floor(rate * 1.6) : 0;
      var OAC = global.OfflineAudioContext || global.webkitOfflineAudioContext;
      var octx = new OAC(orig.numberOfChannels, orig.length + tail, rate);

      // --- bit-crush + decimation directly on the samples ---
      var crushed = octx.createBuffer(orig.numberOfChannels, orig.length, rate);
      var hold = Math.max(1, Math.round(rate / (opts.rate * 1000)));
      var levels = Math.pow(2, opts.bits), half = levels / 2;
      var drive = opts.drive, normDrive = drive > 1 ? Math.tanh(drive) : 1;
      var mix = opts.mix, dry = 1 - mix;
      for (var ch = 0; ch < orig.numberOfChannels; ch++) {
        var inp = orig.getChannelData(ch), outp = crushed.getChannelData(ch), held = 0;
        for (var i = 0; i < inp.length; i++) {
          var s = inp[i];
          if (i % hold === 0) {
            var d = drive > 1 ? Math.tanh(s * drive) / normDrive : s;
            if (d > 1) d = 1; else if (d < -1) d = -1;
            held = Math.round(d * half) / half;
          }
          outp[i] = held * mix + s * dry;
        }
      }

      // --- tone shaping + reverb graph ---
      var src = octx.createBufferSource(); src.buffer = crushed;
      var head = src;
      if (opts.lp * 1000 < nyq) {
        var lp = octx.createBiquadFilter();
        lp.type = 'lowpass'; lp.frequency.value = opts.lp * 1000; lp.Q.value = 0.7;
        head.connect(lp); head = lp;
      }
      head.connect(octx.destination);
      if (opts.reverb > 0) {
        var conv = octx.createConvolver(); conv.buffer = makeIR(octx, 1.6, 2.5);
        var wet = octx.createGain(); wet.gain.value = opts.reverb;
        head.connect(conv); conv.connect(wet); wet.connect(octx.destination);
      }
      src.start(0);
      return octx.startRendering();
    },

    play: function (buffer) {
      var ctx = Synth.ensure(); this.stop();
      var src = ctx.createBufferSource();
      src.buffer = buffer;
      src.connect(Synth.master);
      var self = this;
      src.onended = function () { if (self.source === src) { self.source = null; if (self.onEnded) self.onEnded(); } };
      src.start();
      this.source = src;
    },

    stop: function () {
      if (this.source) { try { this.source.stop(); } catch (e) {} this.source = null; }
    },

    playing: function () { return !!this.source; }
  };

  global.BBB.Crusher = Crusher;
})(window);
