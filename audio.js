/* Cadence — audio engine
 * All focus music is synthesized live with the Web Audio API, so every track is
 * genuinely playable, royalty-free and works offline (no external audio files).
 */
(function () {
  'use strict';

  let ctx = null;
  let master = null;   // music volume
  let fxGain = null;   // notification chimes
  let buffers = null;  // noise buffers

  function ensureCtx() {
    if (ctx) return ctx;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = 0.6;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14; comp.ratio.value = 3;
    master.connect(comp); comp.connect(ctx.destination);
    fxGain = ctx.createGain(); fxGain.gain.value = 0.5; fxGain.connect(ctx.destination);
    buffers = makeNoiseBuffers(ctx);
    return ctx;
  }

  function makeNoiseBuffers(c) {
    const len = c.sampleRate * 4;
    const mk = () => c.createBuffer(2, len, c.sampleRate);
    const white = mk(), pink = mk(), brown = mk();
    for (let ch = 0; ch < 2; ch++) {
      const w = white.getChannelData(ch), p = pink.getChannelData(ch), b = brown.getChannelData(ch);
      let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0, last = 0;
      for (let i = 0; i < len; i++) {
        const x = Math.random() * 2 - 1;
        w[i] = x * 0.5;
        b0 = 0.99886 * b0 + x * 0.0555179; b1 = 0.99332 * b1 + x * 0.0750759;
        b2 = 0.969 * b2 + x * 0.153852; b3 = 0.8665 * b3 + x * 0.3104856;
        b4 = 0.55 * b4 + x * 0.5329522; b5 = -0.7616 * b5 - x * 0.016898;
        p[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + x * 0.5362) * 0.11; b6 = x * 0.115926;
        last = (last + 0.02 * x) / 1.02; b[i] = last * 3.5;
      }
    }
    return { white, pink, brown };
  }

  function rng(seed) {
    let a = seed >>> 0;
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);

  // ---------- building blocks ----------
  function noise(type, dest, { gain = 0.3, filters = [] } = {}) {
    const src = ctx.createBufferSource();
    src.buffer = buffers[type]; src.loop = true;
    src.loopStart = Math.random() * 3;
    let node = src;
    const fnodes = filters.map((f) => {
      const n = ctx.createBiquadFilter();
      n.type = f.type; n.frequency.value = f.freq; if (f.q) n.Q.value = f.q;
      node.connect(n); node = n; return n;
    });
    const g = ctx.createGain(); g.gain.value = gain;
    node.connect(g); g.connect(dest);
    src.start(ctx.currentTime, Math.random() * 3);
    return { src, gain: g, filters: fnodes, stop: (t) => { try { src.stop(t); } catch (e) {} } };
  }

  function lfo(param, { rate = 0.1, depth = 0.1, type = 'sine' }) {
    const o = ctx.createOscillator(); o.type = type; o.frequency.value = rate;
    const g = ctx.createGain(); g.gain.value = depth;
    o.connect(g); g.connect(param); o.start();
    return { stop: (t) => { try { o.stop(t); } catch (e) {} } };
  }

  function env(g, t, a, peak, d, sustainTo = 0.0001) {
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + a);
    g.gain.exponentialRampToValueAtTime(Math.max(sustainTo, 0.0001), t + a + d);
  }

  function tone(dest, freq, t, dur, { type = 'sine', gain = 0.2, attack = 0.01, partials = null, lp = null } = {}) {
    const out = ctx.createGain();
    let tail = out;
    if (lp) { const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = lp; out.connect(f); tail = f; }
    tail.connect(dest);
    const ps = partials || [[1, 1]];
    ps.forEach(([mult, amp, decayMul = 1]) => {
      const o = ctx.createOscillator(); o.type = type; o.frequency.value = freq * mult;
      const g = ctx.createGain(); env(g, t, attack, gain * amp, dur * decayMul);
      o.connect(g); g.connect(out); o.start(t); o.stop(t + attack + dur * decayMul + 0.05);
    });
  }

  const inst = {
    epiano: (d, f, t, dur, v = 1) => tone(d, f, t, dur, { gain: 0.07 * v, attack: 0.008, partials: [[1, 1], [2, 0.25, 0.5], [3.01, 0.08, 0.3]], lp: 2600 }),
    piano: (d, f, t, dur, v = 1) => tone(d, f, t, dur, { gain: 0.09 * v, attack: 0.004, partials: [[1, 1], [2, 0.4, 0.6], [3, 0.15, 0.4], [4.02, 0.07, 0.25]], lp: 3800 }),
    pluck: (d, f, t, dur, v = 1) => tone(d, f, t, dur, { type: 'triangle', gain: 0.08 * v, attack: 0.004, partials: [[1, 1], [2, 0.2, 0.4]], lp: 3000 }),
    bass: (d, f, t, dur, v = 1) => tone(d, f, t, dur, { type: 'sine', gain: 0.16 * v, attack: 0.01, partials: [[1, 1], [2, 0.15]] }),
    pad(d, freqs, t, dur, v = 1) {
      const out = ctx.createGain(); const f = ctx.createBiquadFilter();
      f.type = 'lowpass'; f.frequency.value = 900; f.Q.value = 0.5;
      out.connect(f); f.connect(d);
      out.gain.setValueAtTime(0.0001, t);
      out.gain.linearRampToValueAtTime(0.035 * v, t + dur * 0.35);
      out.gain.linearRampToValueAtTime(0.0001, t + dur + 1.5);
      freqs.forEach((fr) => [-6, 6].forEach((det) => {
        const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = fr; o.detune.value = det;
        o.connect(out); o.start(t); o.stop(t + dur + 1.6);
      }));
    },
    kick(d, t, v = 1) {
      const o = ctx.createOscillator(); const g = ctx.createGain();
      o.frequency.setValueAtTime(120, t); o.frequency.exponentialRampToValueAtTime(42, t + 0.18);
      env(g, t, 0.004, 0.5 * v, 0.35); o.connect(g); g.connect(d); o.start(t); o.stop(t + 0.45);
    },
    snare(d, t, v = 1) {
      const s = ctx.createBufferSource(); s.buffer = buffers.white;
      const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 1700; f.Q.value = 0.8;
      const g = ctx.createGain(); env(g, t, 0.003, 0.22 * v, 0.16);
      s.connect(f); f.connect(g); g.connect(d); s.start(t, Math.random() * 3); s.stop(t + 0.25);
    },
    hat(d, t, v = 1) {
      const s = ctx.createBufferSource(); s.buffer = buffers.white;
      const f = ctx.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = 7000;
      const g = ctx.createGain(); env(g, t, 0.002, 0.07 * v, 0.04);
      s.connect(f); f.connect(g); g.connect(d); s.start(t, Math.random() * 3); s.stop(t + 0.08);
    },
    drop(d, t, r) {
      const s = ctx.createBufferSource(); s.buffer = buffers.white;
      const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 1800 + r() * 3500; f.Q.value = 6;
      const g = ctx.createGain(); env(g, t, 0.002, 0.05 + r() * 0.12, 0.03 + r() * 0.04);
      const p = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
      s.connect(f); f.connect(g);
      if (p) { p.pan.value = r() * 2 - 1; g.connect(p); p.connect(d); } else g.connect(d);
      s.start(t, Math.random() * 3); s.stop(t + 0.1);
    },
    chirp(d, t, r) {
      const n = 2 + Math.floor(r() * 4); const base = 2200 + r() * 1800;
      const p = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
      const out = ctx.createGain(); out.gain.value = 0.5;
      if (p) { p.pan.value = r() * 1.6 - 0.8; out.connect(p); p.connect(d); } else out.connect(d);
      for (let i = 0; i < n; i++) {
        const st = t + i * (0.09 + r() * 0.06);
        const o = ctx.createOscillator(); const g = ctx.createGain();
        o.frequency.setValueAtTime(base, st);
        o.frequency.exponentialRampToValueAtTime(base * (1.3 + r() * 0.5), st + 0.06);
        env(g, st, 0.005, 0.05, 0.07); o.connect(g); g.connect(out); o.start(st); o.stop(st + 0.12);
      }
    },
    cricket(d, t) {
      for (let i = 0; i < 3; i++) {
        const st = t + i * 0.06; const o = ctx.createOscillator(); const g = ctx.createGain();
        o.frequency.value = 4400; env(g, st, 0.004, 0.015, 0.03); o.connect(g); g.connect(d); o.start(st); o.stop(st + 0.05);
      }
    },
    clink(d, t, r) {
      const f = 2400 + r() * 1800;
      tone(d, f, t, 0.35, { gain: 0.025, attack: 0.002, partials: [[1, 1], [2.76, 0.5, 0.6]] });
    },
  };

  // Step scheduler with a generous look-ahead so playback survives timer throttling in background tabs.
  function scheduler(stepDur, onStep) {
    let step = 0; let next = ctx.currentTime + 0.1; let stopped = false;
    const run = () => {
      if (stopped) return;
      const horizon = ctx.currentTime + 1.6;
      while (next < horizon) { onStep(step, next); step++; next += stepDur; }
    };
    run();
    const id = setInterval(run, 120);
    return { stop: () => { stopped = true; clearInterval(id); } };
  }

  function randomEvents(meanGap, fn, r) {
    let next = ctx.currentTime + r() * meanGap; let stopped = false;
    const run = () => {
      if (stopped) return;
      const horizon = ctx.currentTime + 1.6;
      while (next < horizon) { fn(next); next += meanGap * (0.3 + r() * 1.4); }
    };
    run(); const id = setInterval(run, 150);
    return { stop: () => { stopped = true; clearInterval(id); } };
  }

  // ---------- track generators ----------
  function lofi({ bpm, prog, seed, key = 0 }) {
    return (dest) => {
      const r = rng(seed); const parts = [];
      const bus = ctx.createGain(); bus.gain.value = 1; bus.connect(dest);
      const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 3200; lp.connect(bus);
      parts.push(noise('pink', bus, { gain: 0.012, filters: [{ type: 'highpass', freq: 2500 }] }));
      parts.push(randomEvents(0.18, (t) => inst.drop(bus, t, () => r() * 0.25), r)); // vinyl crackle
      const eighth = 60 / bpm / 2;
      parts.push(scheduler(eighth, (s, t) => {
        const swing = s % 2 ? eighth * 0.16 : 0; const tt = t + swing;
        const bar = Math.floor(s / 8) % prog.length; const pos = s % 8; const chord = prog[bar].map((n) => n + key);
        if (pos === 0 || pos === 5) inst.kick(lp, tt, pos === 0 ? 1 : 0.7);
        if (pos === 4) inst.snare(lp, tt, 0.8);
        inst.hat(lp, tt, pos % 2 ? 0.5 : 0.9);
        if (pos === 0) chord.forEach((n, i) => inst.epiano(lp, mtof(n), tt + i * 0.012, eighth * 7, 0.9));
        if (pos === 0 || pos === 6) inst.bass(lp, mtof(chord[0] - 12), tt, eighth * 2.5, 0.9);
        if ((pos === 3 || pos === 7) && r() < 0.45) inst.epiano(lp, mtof(chord[Math.floor(r() * chord.length)] + 12), tt, eighth * 2, 0.6);
      }));
      return parts;
    };
  }

  function ambient({ prog, seed, chordSec = 8 }) {
    return (dest) => {
      const r = rng(seed); const parts = [];
      const bus = ctx.createGain(); bus.connect(dest);
      const delay = ctx.createDelay(2); delay.delayTime.value = 0.6;
      const fb = ctx.createGain(); fb.gain.value = 0.45; delay.connect(fb); fb.connect(delay); delay.connect(bus);
      parts.push(noise('brown', bus, { gain: 0.03, filters: [{ type: 'lowpass', freq: 400 }] }));
      parts.push(scheduler(chordSec, (s, t) => {
        const chord = prog[s % prog.length];
        inst.pad(bus, chord.map(mtof), t, chordSec, 1);
      }));
      parts.push(randomEvents(2.2, (t) => {
        const chord = prog[Math.floor((t / chordSec)) % prog.length];
        const n = chord[Math.floor(r() * chord.length)] + 12 + (r() < 0.3 ? 12 : 0);
        tone(delay, mtof(n), t, 2.5, { gain: 0.03, attack: 0.3 }); tone(bus, mtof(n), t, 2.5, { gain: 0.025, attack: 0.3 });
      }, r));
      return parts;
    };
  }

  function pianoGen({ prog, bpm, seed, pattern }) {
    return (dest) => {
      const r = rng(seed); const parts = [];
      const bus = ctx.createGain(); bus.connect(dest);
      const delay = ctx.createDelay(2); delay.delayTime.value = 0.45;
      const fb = ctx.createGain(); fb.gain.value = 0.25; const wet = ctx.createGain(); wet.gain.value = 0.35;
      bus.connect(delay); delay.connect(fb); fb.connect(delay); delay.connect(wet); wet.connect(dest);
      const step = 60 / bpm / 2;
      parts.push(scheduler(step, (s, t) => {
        const bar = Math.floor(s / 8) % prog.length; const pos = s % 8; const chord = prog[bar];
        if (pos === 0) inst.piano(bus, mtof(chord[0] - 12), t, step * 8, 0.8);
        const idx = pattern[pos]; if (idx != null) inst.piano(bus, mtof(chord[idx % chord.length] + (idx >= chord.length ? 12 : 0)), t, step * 5, 0.55 + r() * 0.2);
        if (pos === 4 && r() < 0.5) inst.piano(bus, mtof(chord[Math.floor(r() * chord.length)] + 24), t + step * 0.5, step * 4, 0.35);
      }));
      return parts;
    };
  }

  function instrumental({ prog, bpm, seed, scale }) {
    return (dest) => {
      const r = rng(seed); const parts = [];
      const bus = ctx.createGain(); bus.connect(dest);
      const delay = ctx.createDelay(2); delay.delayTime.value = 60 / bpm * 0.75;
      const fb = ctx.createGain(); fb.gain.value = 0.3; delay.connect(fb); fb.connect(delay); delay.connect(bus);
      const step = 60 / bpm / 2; let mel = 4;
      parts.push(scheduler(step, (s, t) => {
        const bar = Math.floor(s / 8) % prog.length; const pos = s % 8; const chord = prog[bar];
        if (pos === 0) { inst.pad(bus, chord.map(mtof), t, step * 8, 0.7); inst.bass(bus, mtof(chord[0] - 12), t, step * 6, 0.8); }
        if (pos === 4) inst.bass(bus, mtof(chord[0] - 12), t, step * 3, 0.6);
        if (r() < 0.55) {
          mel = Math.max(0, Math.min(scale.length - 1, mel + Math.floor(r() * 5) - 2));
          inst.pluck(bus, mtof(scale[mel]), t, step * 3, 0.9); inst.pluck(delay, mtof(scale[mel]), t, step * 3, 0.4);
        }
      }));
      return parts;
    };
  }

  function rain({ heavy, seed }) {
    return (dest) => {
      const r = rng(seed); const parts = [];
      const n1 = noise('pink', dest, { gain: heavy ? 0.5 : 0.32, filters: [{ type: 'highpass', freq: 400 }, { type: 'lowpass', freq: heavy ? 7000 : 5000 }] });
      parts.push(n1, lfo(n1.gain.gain, { rate: 0.07, depth: 0.06 }));
      parts.push(noise('brown', dest, { gain: heavy ? 0.25 : 0.12, filters: [{ type: 'lowpass', freq: 500 }] }));
      parts.push(randomEvents(heavy ? 0.03 : 0.07, (t) => inst.drop(dest, t, r), r));
      if (heavy) parts.push(randomEvents(28, (t) => { // distant thunder
        const s = noise('brown', dest, { gain: 0.0001, filters: [{ type: 'lowpass', freq: 160 }] });
        s.gain.gain.setValueAtTime(0.0001, t); s.gain.gain.exponentialRampToValueAtTime(0.9, t + 1.2); s.gain.gain.exponentialRampToValueAtTime(0.0001, t + 7); s.stop(t + 7.2);
      }, r));
      return parts;
    };
  }

  function ocean({ seed, period = 9 }) {
    return (dest) => {
      const parts = [];
      const n = noise('brown', dest, { gain: 0.35, filters: [{ type: 'lowpass', freq: 700 }] });
      const n2 = noise('pink', dest, { gain: 0.08, filters: [{ type: 'bandpass', freq: 1600, q: 0.5 }] });
      parts.push(n, n2, lfo(n.gain.gain, { rate: 1 / period, depth: 0.3 }), lfo(n.filters[0].frequency, { rate: 1 / period, depth: 450 }), lfo(n2.gain.gain, { rate: 1 / period, depth: 0.07 }));
      return parts;
    };
  }

  function forest({ seed, crickets }) {
    return (dest) => {
      const r = rng(seed); const parts = [];
      const wind = noise('pink', dest, { gain: 0.12, filters: [{ type: 'bandpass', freq: 600, q: 0.4 }] });
      parts.push(wind, lfo(wind.gain.gain, { rate: 0.05, depth: 0.08 }), lfo(wind.filters[0].frequency, { rate: 0.03, depth: 300 }));
      parts.push(randomEvents(crickets ? 6 : 2.8, (t) => inst.chirp(dest, t, r), r));
      if (crickets) parts.push(randomEvents(0.5, (t) => inst.cricket(dest, t), r));
      return parts;
    };
  }

  function nature({ seed }) {
    return (dest) => {
      const r = rng(seed); const parts = [];
      const stream = noise('white', dest, { gain: 0.1, filters: [{ type: 'bandpass', freq: 2200, q: 0.6 }] });
      parts.push(stream, lfo(stream.filters[0].frequency, { rate: 0.4, depth: 500 }));
      parts.push(noise('brown', dest, { gain: 0.15, filters: [{ type: 'lowpass', freq: 800 }] }));
      parts.push(randomEvents(0.12, (t) => inst.drop(dest, t, () => r() * 0.5), r));
      parts.push(randomEvents(5, (t) => inst.chirp(dest, t, r), r));
      return parts;
    };
  }

  function plainNoise({ type, lp }) {
    return (dest) => [noise(type, dest, { gain: type === 'white' ? 0.25 : 0.4, filters: lp ? [{ type: 'lowpass', freq: lp }] : [] })];
  }

  function cafe({ seed, busy }) {
    return (dest) => {
      const r = rng(seed); const parts = [];
      const murmur = noise('brown', dest, { gain: busy ? 0.5 : 0.35, filters: [{ type: 'bandpass', freq: 450, q: 0.7 }] });
      const voices = noise('pink', dest, { gain: 0.05, filters: [{ type: 'bandpass', freq: 1100, q: 1.2 }] });
      parts.push(murmur, voices, lfo(voices.filters[0].frequency, { rate: 0.7, depth: 300 }), lfo(murmur.gain.gain, { rate: 0.13, depth: 0.08 }));
      parts.push(randomEvents(busy ? 1.6 : 3, (t) => inst.clink(dest, t, r), r));
      return parts;
    };
  }

  // ---------- catalogue ----------
  const S = (n) => n; // readability for MIDI numbers
  const LIB = [
    { id: 'lofi', name: 'Lo-fi', tracks: [
      { id: 'lofi-1', title: 'Late Library', length: 240, gen: lofi({ bpm: 78, seed: 11, prog: [[53, 57, 60, 64], [52, 55, 59, 62], [50, 53, 57, 60], [48, 52, 55, 59]] }) },
      { id: 'lofi-2', title: 'Window Seat', length: 210, gen: lofi({ bpm: 72, seed: 22, prog: [[57, 60, 64, 67], [50, 53, 57, 60], [55, 59, 62, 65], [48, 52, 55, 59]] }) },
      { id: 'lofi-3', title: 'Warm Mug', length: 225, gen: lofi({ bpm: 84, seed: 33, key: 3, prog: [[48, 52, 55, 59], [45, 48, 52, 55], [50, 53, 57, 60], [43, 47, 50, 53]] }) },
    ] },
    { id: 'ambient', name: 'Ambient', tracks: [
      { id: 'amb-1', title: 'Slow Horizon', length: 300, gen: ambient({ seed: 5, prog: [[S(48), 55, 62, 64], [45, 52, 60, 64], [41, 48, 55, 60], [43, 50, 57, 62]] }) },
      { id: 'amb-2', title: 'Glass Fog', length: 300, gen: ambient({ seed: 6, chordSec: 10, prog: [[50, 57, 62, 65], [46, 53, 58, 62], [43, 50, 55, 62]] }) },
    ] },
    { id: 'rain', name: 'Rain Sounds', tracks: [
      { id: 'rain-1', title: 'Soft Rain on Glass', length: 600, gen: rain({ heavy: false, seed: 7 }) },
      { id: 'rain-2', title: 'Storm, Far Away', length: 600, gen: rain({ heavy: true, seed: 8 }) },
    ] },
    { id: 'nature', name: 'Nature Sounds', tracks: [
      { id: 'nat-1', title: 'Creek & Birds', length: 600, gen: nature({ seed: 9 }) },
      { id: 'nat-2', title: 'Summer Evening', length: 600, gen: forest({ seed: 10, crickets: true }) },
    ] },
    { id: 'white', name: 'White Noise', tracks: [
      { id: 'wn-1', title: 'White Noise', length: 900, gen: plainNoise({ type: 'white' }) },
      { id: 'wn-2', title: 'Pink Noise', length: 900, gen: plainNoise({ type: 'pink' }) },
      { id: 'wn-3', title: 'Brown Noise', length: 900, gen: plainNoise({ type: 'brown', lp: 1200 }) },
    ] },
    { id: 'instrumental', name: 'Instrumental', tracks: [
      { id: 'ins-1', title: 'Paper Boats', length: 240, gen: instrumental({ bpm: 92, seed: 12, prog: [[48, 55, 64], [45, 52, 60], [41, 48, 57], [43, 50, 59]], scale: [60, 62, 64, 67, 69, 72, 74, 76] }) },
      { id: 'ins-2', title: 'Quiet Engine', length: 240, gen: instrumental({ bpm: 100, seed: 13, prog: [[50, 57, 65], [46, 53, 62], [48, 55, 64], [45, 52, 60]], scale: [62, 64, 65, 69, 70, 72, 74, 77] }) },
    ] },
    { id: 'piano', name: 'Piano', tracks: [
      { id: 'pno-1', title: 'First Light', length: 240, gen: pianoGen({ bpm: 66, seed: 14, pattern: [null, 0, 1, 2, 3, 2, 1, 0], prog: [[60, 64, 67, 71], [57, 60, 64, 67], [53, 57, 60, 64], [55, 59, 62, 65]] }) },
      { id: 'pno-2', title: 'Still Water', length: 240, gen: pianoGen({ bpm: 58, seed: 15, pattern: [null, 1, 2, 4, null, 3, 2, 1], prog: [[57, 60, 64], [53, 57, 60], [48, 52, 55], [55, 59, 62]] }) },
    ] },
    { id: 'cafe', name: 'Café Ambience', tracks: [
      { id: 'cafe-1', title: 'Corner Café', length: 600, gen: cafe({ seed: 16, busy: false }) },
      { id: 'cafe-2', title: 'Busy Morning', length: 600, gen: cafe({ seed: 17, busy: true }) },
    ] },
    { id: 'ocean', name: 'Ocean Sounds', tracks: [
      { id: 'oc-1', title: 'Low Tide', length: 600, gen: ocean({ seed: 18, period: 10 }) },
      { id: 'oc-2', title: 'Shoreline', length: 600, gen: ocean({ seed: 19, period: 7 }) },
    ] },
    { id: 'forest', name: 'Forest Sounds', tracks: [
      { id: 'for-1', title: 'Morning Canopy', length: 600, gen: forest({ seed: 20, crickets: false }) },
      { id: 'for-2', title: 'Pine Wind', length: 600, gen: forest({ seed: 21, crickets: false }) },
    ] },
  ];

  // ---------- player ----------
  const state = { track: null, playing: false, elapsedBefore: 0, startedAt: 0, parts: [], bus: null, endTimer: null };
  const listeners = new Set();
  const emit = (ev) => listeners.forEach((fn) => { try { fn(ev); } catch (e) { console.error(e); } });

  function findTrack(id) {
    for (const c of LIB) for (const t of c.tracks) if (t.id === id) return Object.assign({ category: c.id, categoryName: c.name }, t);
    return null;
  }

  function stopParts(fade = 0.4) {
    if (!ctx) return;
    const t = ctx.currentTime; const bus = state.bus; const parts = state.parts;
    if (bus) { bus.gain.cancelScheduledValues(t); bus.gain.setValueAtTime(bus.gain.value, t); bus.gain.linearRampToValueAtTime(0.0001, t + fade); }
    setTimeout(() => { parts.forEach((p) => p && p.stop && p.stop()); try { bus && bus.disconnect(); } catch (e) {} }, fade * 1000 + 60);
    state.parts = []; state.bus = null;
  }

  function startParts() {
    const bus = ctx.createGain(); bus.gain.value = 0.0001; bus.connect(master);
    bus.gain.linearRampToValueAtTime(1, ctx.currentTime + 1.2);
    state.bus = bus; state.parts = state.track.gen(bus) || [];
    state.startedAt = ctx.currentTime;
  }

  function position() {
    if (!state.track) return 0;
    if (!state.playing || !ctx) return state.elapsedBefore;
    return state.elapsedBefore + (ctx.currentTime - state.startedAt);
  }

  function watchEnd() {
    clearInterval(state.endTimer);
    state.endTimer = setInterval(() => {
      if (state.playing && state.track && position() >= state.track.length) {
        clearInterval(state.endTimer); emit({ type: 'ended', track: state.track });
      }
    }, 500);
  }

  const api = {
    library: LIB.map((c) => ({ id: c.id, name: c.name, tracks: c.tracks.map((t) => ({ id: t.id, title: t.title, length: t.length, category: c.id, categoryName: c.name })) })),
    supported: !!(window.AudioContext || window.webkitAudioContext),
    findTrack(id) { const t = findTrack(id); return t ? { id: t.id, title: t.title, length: t.length, category: t.category, categoryName: t.categoryName } : null; },
    on(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    async play(trackId) {
      if (!ensureCtx()) return false;
      if (ctx.state === 'suspended') { try { await ctx.resume(); } catch (e) {} }
      const t = findTrack(trackId); if (!t) return false;
      stopParts(0.5);
      state.track = t; state.elapsedBefore = 0; state.playing = true;
      startParts(); watchEnd(); emit({ type: 'play', track: t }); return true;
    },
    async resume() {
      if (!state.track) return false;
      if (!ensureCtx()) return false;
      if (ctx.state === 'suspended') { try { await ctx.resume(); } catch (e) {} }
      if (state.playing) return true;
      state.playing = true; startParts(); watchEnd(); emit({ type: 'play', track: state.track }); return true;
    },
    pause() {
      if (!state.playing) return;
      state.elapsedBefore = position(); state.playing = false; stopParts(0.3); clearInterval(state.endTimer);
      emit({ type: 'pause', track: state.track });
    },
    stop() { if (state.playing) api.pause(); state.track = null; state.elapsedBefore = 0; emit({ type: 'stop' }); },
    seek(sec) {
      if (!state.track) return;
      const v = Math.max(0, Math.min(state.track.length - 1, sec));
      if (state.playing && ctx) { state.elapsedBefore = v; state.startedAt = ctx.currentTime; } else state.elapsedBefore = v;
    },
    setVolume(v) { ensureCtx(); if (master) master.gain.setTargetAtTime(Math.max(0, Math.min(1, v)), ctx.currentTime, 0.05); },
    get current() { return state.track ? api.findTrack(state.track.id) : null; },
    get playing() { return state.playing; },
    position,
    async chime(kind = 'notify', volume = 0.5) {
      if (!ensureCtx()) return;
      if (ctx.state === 'suspended') { try { await ctx.resume(); } catch (e) {} }
      fxGain.gain.value = volume;
      const t = ctx.currentTime + 0.02;
      const seqs = {
        focusEnd: [[72, 0], [76, 0.18], [79, 0.36], [84, 0.6]],
        breakEnd: [[79, 0], [72, 0.25]],
        notify: [[81, 0], [76, 0.14]],
        screen: [[69, 0], [76, 0.5]],
        achieve: [[72, 0], [79, 0.12], [88, 0.26]],
      };
      (seqs[kind] || seqs.notify).forEach(([n, dt]) => tone(fxGain, mtof(n), t + dt, 1.4, { gain: 0.25, attack: 0.005, partials: [[1, 1], [2, 0.3, 0.5], [3, 0.1, 0.3]] }));
    },
  };

  window.CadenceAudio = api;
})();
