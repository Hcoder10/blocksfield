// ThreeKit audio: music with crossfade + loop, sfx with pitch variation, and procedural WebAudio fallback sounds so a
// game is never silent. Audio.auto(game) maps CONTRACT events to sounds, preferring generated sfx from the assets
// manifest (game.asset(name), with variants name_2, name_3...). See docs/Audio.md.
import { reportError } from './core.js';

let ctx = null, master = null, musicBus = null, sfxBus = null, musicFilter = null, noiseBuf = null;
const vol = { master: 0.9, music: 0.55, sfx: 0.8 };
let muted = false;

function ac() {
  if (ctx) return ctx;
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return null;
  ctx = new AC({ latencyHint: 'interactive' });
  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -14; comp.knee.value = 10; comp.ratio.value = 4; comp.attack.value = 0.003; comp.release.value = 0.2;
  master = ctx.createGain(); master.gain.value = vol.master;
  musicFilter = ctx.createBiquadFilter(); musicFilter.type = 'lowpass'; musicFilter.frequency.value = 20000; musicFilter.Q.value = 0.5;
  musicBus = ctx.createGain(); musicBus.gain.value = vol.music;
  sfxBus = ctx.createGain(); sfxBus.gain.value = vol.sfx;
  musicBus.connect(musicFilter).connect(master);
  sfxBus.connect(master);
  master.connect(comp).connect(ctx.destination);
  const n = ctx.sampleRate * 1.5;
  noiseBuf = ctx.createBuffer(1, n, ctx.sampleRate);
  const d = noiseBuf.getChannelData(0);
  for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
  return ctx;
}

// autoplay policy: the context starts suspended until the first user gesture
let unlockHooked = false;
function hookUnlock() {
  if (unlockHooked) return;
  unlockHooked = true;
  const unlock = () => {
    const c = ac();
    if (c && c.state !== 'running') c.resume().catch(() => {});
    if (c && c.state === 'running') for (const t of ['pointerdown', 'keydown', 'touchstart', 'mousedown']) window.removeEventListener(t, unlock, true);
  };
  for (const t of ['pointerdown', 'keydown', 'touchstart', 'mousedown']) window.addEventListener(t, unlock, true);
  // headless harness runs with --autoplay-policy=no-user-gesture-required: resume straight away when allowed
  const c = ac(); if (c) c.resume().catch(() => {});
}

export function unlocked() { return !!ctx && ctx.state === 'running'; }
export function context() { hookUnlock(); return ac(); }

// ---- buffers ----
const buffers = new Map();   // url -> Promise<AudioBuffer|null>
function load(url) {
  if (!buffers.has(url)) {
    buffers.set(url, (async () => {
      const r = await fetch(url);
      if (!r.ok) throw new Error(`Audio: ${r.status} loading ${url}`);
      const b = await r.arrayBuffer();
      return await new Promise((res, rej) => ac().decodeAudioData(b, res, rej));
    })().catch((e) => { reportError(new Error(`Audio: could not load "${url}": ${e && e.message || e}`)); return null; }));
  }
  return buffers.get(url);
}
export function preload(game, names = []) { for (const n of names) { const u = resolve(game, n); if (u) load(u); } }

// ---- music ----
let current = null;   // {src, gain, url}
export function music(game, url, opts = {}) {
  const { volume = 1, loop = true, fade = 1.5, rate = 1 } = opts;
  hookUnlock();
  const c = ac();
  if (!c) return null;
  if (url && !/[/.]/.test(url) && game && game.asset) url = game.asset(url) || game.asset('music_' + url) || null;
  if (!url) {
    if (opts.procedural === false) return null;
    return startProcedural(game, { volume: volume * 0.7, fade, style: opts.style });
  }
  if (current && current.url === url) return current;
  const handle = { url, gain: c.createGain(), src: null, stopped: false, stop: (f = fade) => stopTrack(handle, f) };
  handle.gain.gain.value = 0;
  handle.gain.connect(musicBus);
  const prev = current; current = handle;
  load(url).then((buf) => {
    if (!buf || handle.stopped) return;
    const src = c.createBufferSource();
    src.buffer = buf; src.loop = loop; src.playbackRate.value = rate;
    src.connect(handle.gain);
    src.start();
    handle.src = src;
    const t = c.currentTime;
    handle.gain.gain.cancelScheduledValues(t);
    handle.gain.gain.setValueAtTime(0, t);
    handle.gain.gain.linearRampToValueAtTime(volume, t + Math.max(0.05, fade));
    if (prev) stopTrack(prev, fade);
    if (!loop) src.onended = () => { if (current === handle) current = null; };
  });
  return handle;
}
function stopTrack(h, fade = 1) {
  if (!h || h.stopped) return;
  h.stopped = true;
  const c = ac(), t = c.currentTime;
  if (h.proc) h.proc.stop();
  h.gain.gain.cancelScheduledValues(t);
  h.gain.gain.setValueAtTime(h.gain.gain.value, t);
  h.gain.gain.linearRampToValueAtTime(0, t + Math.max(0.05, fade));
  setTimeout(() => { try { h.src && h.src.stop(); h.gain.disconnect(); } catch {} }, (fade + 0.2) * 1000);
  if (current === h) current = null;
}
export function stopMusic(fade = 1) { stopTrack(current, fade); }

// muffle music (pause menu, underwater): duck(true) / duck(false)
export function duck(on = true, { freq = 700, gain = 0.5, time = 0.35 } = {}) {
  const c = ac(); if (!c) return;
  const t = c.currentTime;
  musicFilter.frequency.cancelScheduledValues(t);
  musicFilter.frequency.setTargetAtTime(on ? freq : 20000, t, time / 3);
  musicBus.gain.cancelScheduledValues(t);
  musicBus.gain.setTargetAtTime(muted ? 0 : (on ? vol.music * gain : vol.music), t, time / 3);
}

export function volume(v = {}) {
  Object.assign(vol, v);
  if (ctx) { master.gain.value = muted ? 0 : vol.master; musicBus.gain.value = vol.music; sfxBus.gain.value = vol.sfx; }
  return { ...vol };
}
export function isMuted() { return muted; }
export function mute(on = !muted) { muted = !!on; if (ctx) master.gain.setTargetAtTime(muted ? 0 : vol.master, ctx.currentTime, 0.05); return muted; }

// ---- sfx ----
const lastPlay = new Map();
function resolve(game, name) {
  if (!name) return null;
  if (/[/.]/.test(name)) return name;
  if (!game || !game.asset) return null;
  let base = game.asset('sfx_' + name) ? 'sfx_' + name : game.asset(name) && kindOf(game, name) !== 'music' ? name : null;
  if (!base) { const ev = byEvent(game, name); if (ev.length) return game.asset(ev[Math.floor(Math.random() * ev.length)]); }
  if (!base) return null;
  const variants = [base];
  for (let i = 2; i <= 6; i++) if (game.asset(`${base}_${i}`)) variants.push(`${base}_${i}`); else break;
  return game.asset(variants[Math.floor(Math.random() * variants.length)]);
}

function kindOf(game, key) { const m = game.assets && game.assets.manifest; return m && m[key] ? m[key].kind : null; }
// generated sfx tagged with a CONTRACT event: {"kind":"sfx","file":"sfx_collect.mp3","event":"collect"}
function byEvent(game, ev) {
  const m = game && game.assets && game.assets.manifest, out = [];
  if (m) for (const k in m) if (m[k] && m[k].kind === 'sfx' && m[k].event === ev) out.push(k);
  return out;
}
export function sfx(game, nameOrUrl, opts = {}) {
  const { volume = 1, pitchVariation = 0.06, rate = 1, minGap = 0.035, procedural = true } = opts;
  if (typeof nameOrUrl !== 'string' || !nameOrUrl) throw new Error(`Audio.sfx(game, name): name must be a string like 'coin' or a url; built-ins: ${Object.keys(SYNTH).join(', ')}`);
  hookUnlock();
  const c = ac();
  if (!c) return false;
  const now = c.currentTime;
  if (now - (lastPlay.get(nameOrUrl) ?? -1) < minGap) return false;   // coins collected in one frame -> one sound
  lastPlay.set(nameOrUrl, now);
  const r = rate * (1 + (Math.random() * 2 - 1) * pitchVariation);
  const url = resolve(game, nameOrUrl);
  if (url) {
    load(url).then((buf) => {
      if (!buf) { if (procedural && SYNTH[nameOrUrl]) synth(nameOrUrl, volume, r); return; }
      const src = c.createBufferSource(), g = c.createGain();
      src.buffer = buf; src.playbackRate.value = r; g.gain.value = volume * (opts.gain ?? 0.9);
      src.connect(g).connect(sfxBus); src.start();
    });
    return true;
  }
  const key = SYNTH[nameOrUrl] ? nameOrUrl : ALIAS[nameOrUrl];
  if (key && procedural) { synth(key, volume, r); return true; }
  if (!warned.has(nameOrUrl)) { warned.add(nameOrUrl); console.warn(`Audio.sfx: no asset "${nameOrUrl}" and no built-in; built-ins: ${Object.keys(SYNTH).join(', ')}`); }
  return false;
}
const warned = new Set();

// ---- procedural synth ----
function env(g, t, a, peak, d, sustain = 0.0001) {
  g.gain.cancelScheduledValues(t);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.linearRampToValueAtTime(peak, t + a);
  g.gain.exponentialRampToValueAtTime(Math.max(sustain, 0.0001), t + a + d);
}
function osc(type, f0, f1, t, dur, peak, { a = 0.004, out = sfxBus, detune = 0, curve = 'exp' } = {}) {
  const o = ctx.createOscillator(), g = ctx.createGain();
  o.type = type; o.detune.value = detune;
  o.frequency.setValueAtTime(f0, t);
  if (f1 && f1 !== f0) (curve === 'exp' ? o.frequency.exponentialRampToValueAtTime(f1, t + dur) : o.frequency.linearRampToValueAtTime(f1, t + dur));
  env(g, t, a, peak, dur);
  o.connect(g).connect(out);
  o.start(t); o.stop(t + a + dur + 0.05);
  return o;
}
function noise(t, dur, peak, { type = 'bandpass', f0 = 1200, f1 = null, q = 1, a = 0.003, out = sfxBus } = {}) {
  const s = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain();
  s.buffer = noiseBuf; s.loop = true;
  f.type = type; f.Q.value = q; f.frequency.setValueAtTime(f0, t);
  if (f1) f.frequency.exponentialRampToValueAtTime(f1, t + dur);
  env(g, t, a, peak, dur);
  s.connect(f).connect(g).connect(out);
  s.start(t, Math.random()); s.stop(t + a + dur + 0.05);
}
function echo(out = sfxBus, time = 0.11, fb = 0.28, wet = 0.35) {
  const d = ctx.createDelay(1), g = ctx.createGain(), w = ctx.createGain(), inp = ctx.createGain();
  d.delayTime.value = time; g.gain.value = fb; w.gain.value = wet;
  inp.connect(out); inp.connect(d); d.connect(g).connect(d); d.connect(w).connect(out);
  setTimeout(() => { try { inp.disconnect(); d.disconnect(); w.disconnect(); } catch {} }, 2500);
  return inp;
}
const N = (m) => 440 * Math.pow(2, (m - 69) / 12);   // midi -> Hz

const SYNTH = {
  coin(v, r) {      // classic two-step pickup: B5 -> E6, bright square with a soft sine body
    const t = ctx.currentTime, e = echo(sfxBus, 0.075, 0.2, 0.18);
    osc('square', N(83) * r, null, t, 0.07, 0.11 * v, { out: e });
    osc('square', N(88) * r, null, t + 0.065, 0.28, 0.11 * v, { out: e });
    osc('sine', N(88) * r * 2, null, t + 0.065, 0.22, 0.06 * v, { out: e });
  },
  gem(v, r) {       // glassy upward sparkle
    const t = ctx.currentTime, e = echo(sfxBus, 0.09, 0.3, 0.3);
    [84, 88, 91, 96].forEach((m, i) => { osc('triangle', N(m) * r, null, t + i * 0.045, 0.3, 0.13 * v, { out: e }); osc('sine', N(m + 12) * r, null, t + i * 0.045, 0.18, 0.05 * v, { out: e }); });
  },
  star(v, r) { SYNTH.gem(v, r * 1.12); SYNTH.coin(v * 0.6, r); },
  jump(v, r) {      // springy rising blip
    const t = ctx.currentTime;
    osc('square', 210 * r, 620 * r, t, 0.13, 0.07 * v, { a: 0.002 });
    osc('triangle', 300 * r, 900 * r, t, 0.12, 0.12 * v, { a: 0.002 });
  },
  land(v, r) {      // soft thump + scuff
    const t = ctx.currentTime;
    osc('sine', 150 * r, 55 * r, t, 0.12, 0.35 * v, { a: 0.002 });
    noise(t, 0.09, 0.12 * v, { type: 'lowpass', f0: 1400 * r, f1: 300, q: 0.7 });
  },
  step(v, r) { const t = ctx.currentTime; noise(t, 0.05, 0.06 * v, { type: 'bandpass', f0: 900 * r, q: 1.2 }); },
  boost(v, r) {     // whoosh with a rising engine growl
    const t = ctx.currentTime;
    noise(t, 0.7, 0.32 * v, { type: 'bandpass', f0: 400 * r, f1: 3200 * r, q: 1.6, a: 0.06 });
    osc('sawtooth', 90 * r, 260 * r, t, 0.55, 0.06 * v, { a: 0.04 });
    osc('sawtooth', 91 * r, 262 * r, t, 0.55, 0.05 * v, { a: 0.04, detune: 12 });
  },
  whoosh(v, r) { const t = ctx.currentTime; noise(t, 0.35, 0.22 * v, { type: 'bandpass', f0: 600 * r, f1: 2400 * r, q: 2, a: 0.08 }); },
  hit(v, r) {       // crunchy impact
    const t = ctx.currentTime;
    noise(t, 0.16, 0.45 * v, { type: 'lowpass', f0: 3000 * r, f1: 200, q: 1 });
    osc('square', 220 * r, 70 * r, t, 0.18, 0.13 * v, { a: 0.001 });
    osc('sine', 120 * r, 40 * r, t, 0.2, 0.35 * v, { a: 0.001 });
  },
  hurt(v, r) { SYNTH.hit(v * 0.8, r * 1.2); },
  explosion(v, r) {
    const t = ctx.currentTime;
    noise(t, 0.9, 0.6 * v, { type: 'lowpass', f0: 2200 * r, f1: 90, q: 0.8, a: 0.004 });
    osc('sine', 90 * r, 28 * r, t, 0.7, 0.5 * v, { a: 0.002 });
  },
  checkpoint(v, r) { // bright bell chime, two notes with echo
    const t = ctx.currentTime, e = echo(sfxBus, 0.14, 0.32, 0.35);
    [[79, 0], [86, 0.1]].forEach(([m, dt]) => {
      osc('triangle', N(m) * r, null, t + dt, 0.55, 0.16 * v, { out: e });
      osc('sine', N(m + 19) * r, null, t + dt, 0.3, 0.04 * v, { out: e });   // bell partial
    });
  },
  powerup(v, r) {
    const t = ctx.currentTime, e = echo(sfxBus, 0.08, 0.25, 0.25);
    for (let i = 0; i < 8; i++) osc('square', N(60 + [0, 4, 7, 12, 16, 19, 24, 28][i]) * r, null, t + i * 0.04, 0.09, 0.07 * v, { out: e });
  },
  win(v, r) {       // little fanfare: C E G C' then a held major chord
    const t = ctx.currentTime, e = echo(sfxBus, 0.16, 0.3, 0.3);
    [72, 76, 79].forEach((m, i) => { osc('square', N(m) * r, null, t + i * 0.12, 0.12, 0.08 * v, { out: e }); osc('triangle', N(m) * r, null, t + i * 0.12, 0.14, 0.12 * v, { out: e }); });
    [84, 79, 76, 72].forEach((m) => { osc('square', N(m) * r, null, t + 0.38, 0.9, 0.05 * v, { out: e, a: 0.01 }); osc('triangle', N(m) * r, null, t + 0.38, 1.1, 0.09 * v, { out: e, a: 0.01 }); });
    noise(t + 0.38, 0.5, 0.05 * v, { type: 'highpass', f0: 6000, q: 0.5 });
  },
  lose(v, r) {      // sad descending "wah wah"
    const t = ctx.currentTime;
    [[67, 0], [66, 0.32], [65, 0.64]].forEach(([m, dt]) => { osc('sawtooth', N(m) * r, N(m) * r * 0.985, t + dt, 0.3, 0.06 * v, { a: 0.02 }); osc('triangle', N(m - 12) * r, null, t + dt, 0.3, 0.14 * v, { a: 0.02 }); });
    osc('sawtooth', N(64) * r, N(58) * r, t + 0.96, 0.9, 0.06 * v, { a: 0.02, curve: 'lin' });
    osc('triangle', N(52) * r, N(46) * r, t + 0.96, 0.9, 0.14 * v, { a: 0.02, curve: 'lin' });
  },
  death(v, r) { SYNTH.hit(v * 0.7, r * 0.8); const t = ctx.currentTime; osc('square', 520 * r, 90 * r, t + 0.05, 0.45, 0.07 * v, { curve: 'lin' }); },
  respawn(v, r) { const t = ctx.currentTime, e = echo(); osc('sine', 300 * r, 1200 * r, t, 0.35, 0.12 * v, { out: e }); noise(t, 0.35, 0.06 * v, { type: 'highpass', f0: 3000, f1: 8000 }); },
  click(v, r) { const t = ctx.currentTime; osc('square', 1800 * r, 1200 * r, t, 0.025, 0.06 * v, { a: 0.001 }); osc('sine', 900 * r, null, t, 0.04, 0.08 * v, { a: 0.001 }); },
  hover(v, r) { const t = ctx.currentTime; osc('sine', 1300 * r, null, t, 0.03, 0.04 * v, { a: 0.002 }); },
  tick(v, r) { const t = ctx.currentTime; osc('square', N(72) * r, null, t, 0.12, 0.08 * v); osc('sine', N(84) * r, null, t, 0.12, 0.08 * v); },
  go(v, r) { const t = ctx.currentTime, e = echo(sfxBus, 0.12, 0.25, 0.25); osc('square', N(84) * r, null, t, 0.5, 0.09 * v, { out: e }); osc('sine', N(96) * r, null, t, 0.5, 0.08 * v, { out: e }); osc('triangle', N(72) * r, null, t, 0.5, 0.12 * v, { out: e }); },
  banner(v, r) { SYNTH.whoosh(v * 0.8, r * 1.3); },
  open(v, r) { const t = ctx.currentTime; osc('triangle', N(76) * r, N(83) * r, t, 0.12, 0.1 * v); },
  splash(v, r) { const t = ctx.currentTime; noise(t, 0.45, 0.3 * v, { type: 'lowpass', f0: 4000 * r, f1: 400, q: 0.6, a: 0.01 }); noise(t + 0.03, 0.25, 0.12 * v, { type: 'highpass', f0: 3000, q: 0.5 }); },
};
const ALIAS = { collect: 'coin', pickup: 'coin', score: 'coin', key: 'gem', seed: 'coin', heart: 'powerup', damage: 'hit',
  goal: 'win', lap: 'checkpoint', select: 'click', button: 'click', countdown: 'tick', start: 'go', explode: 'explosion', water: 'splash' };
export const SFX = Object.keys(SYNTH);   // built-in procedural sfx names (CONTRACT choice list)
export const builtins = SFX;

function synth(name, v = 1, r = 1) {
  const c = ac(); if (!c) return;
  try { SYNTH[name](v, r); } catch (e) { reportError(e); }
}

// ---- procedural music fallback: a gentle looping groove so a game without generated music still has a pulse ----
const PROGS = {
  arcade: { bpm: 128, prog: [[60, 64, 67], [57, 60, 64], [65, 69, 72], [67, 71, 74]], lead: 'square', bass: 'triangle' },
  cozy: { bpm: 92, prog: [[60, 64, 67, 71], [57, 60, 64, 67], [62, 65, 69, 72], [55, 59, 62, 65]], lead: 'triangle', bass: 'sine' },
  dark: { bpm: 84, prog: [[57, 60, 64], [53, 57, 60], [55, 58, 62], [52, 56, 59]], lead: 'triangle', bass: 'sawtooth' },
  scifi: { bpm: 118, prog: [[57, 60, 64], [57, 60, 64], [53, 57, 60], [55, 59, 62]], lead: 'sawtooth', bass: 'square' },
};
function startProcedural(game, { volume = 0.6, fade = 1.5, style = 'arcade' } = {}) {
  const c = ac();
  if (current && current.proc) return current;
  const P = PROGS[style] || PROGS.arcade;
  const handle = { url: 'procedural:' + style, gain: c.createGain(), stopped: false, stop: (f = fade) => stopTrack(handle, f) };
  handle.gain.gain.value = 0;
  handle.gain.connect(musicBus);
  const prev = current; current = handle;
  if (prev) stopTrack(prev, fade);
  const t0 = c.currentTime + 0.05;
  handle.gain.gain.setValueAtTime(0, t0); handle.gain.gain.linearRampToValueAtTime(volume, t0 + fade);
  const beat = 60 / P.bpm, step = beat / 2;
  let next = t0, n = 0;
  const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = style === 'scifi' ? 1800 : 2600; lp.connect(handle.gain);
  const e = c.createDelay(1); e.delayTime.value = beat * 0.75; const fb = c.createGain(); fb.gain.value = 0.25; const wet = c.createGain(); wet.gain.value = 0.22;
  lp.connect(e); e.connect(fb).connect(e); e.connect(wet).connect(handle.gain);
  const mel = [0, 2, 1, 2, 0, 1, 2, 1];
  const seed = (game && game.rand) ? Math.floor(game.rand() * 8) : 0;
  const sched = () => {
    if (handle.stopped) return;
    while (next < c.currentTime + 0.4) {
      const bar = Math.floor(n / 8) % P.prog.length, s = n % 8, chord = P.prog[bar];
      if (s === 0 || s === 4) osc(P.bass, N(chord[0] - 24), null, next, step * 3.2, 0.22, { out: lp, a: 0.01 });
      if (s % 2 === 0) noise(next, 0.03, s % 4 === 0 ? 0.05 : 0.025, { type: 'highpass', f0: 7000, out: lp });
      if (s === 0 || s === 4) osc('sine', 110, 45, next, 0.14, s === 0 ? 0.3 : 0.18, { out: handle.gain, a: 0.002 });
      const m = chord[mel[(s + seed) % 8] % chord.length] + ((n >> 4) % 2 ? 12 : 0);
      if (s !== 7) osc(P.lead, N(m), null, next, step * 0.9, P.lead === 'square' || P.lead === 'sawtooth' ? 0.035 : 0.07, { out: lp, a: 0.006 });
      if (s === 0) chord.forEach((cm) => osc('triangle', N(cm), null, next, beat * 3.6, 0.025, { out: lp, a: 0.15 }));
      next += step; n++;
    }
  };
  const iv = setInterval(sched, 100);
  sched();
  handle.proc = { stop() { clearInterval(iv); } };
  return handle;
}

// ---- auto: CONTRACT events -> sounds ----
export function auto(game, opts = {}) {
  if (!game || !game.on) throw new Error('Audio.auto(game): first argument must be the game from createGame()');
  if (game.__audioAuto) return game.__audioAuto;
  hookUnlock();
  const map = { collect: 'coin', jump: 'jump', land: 'land', boost: 'boost', damage: 'hit', death: 'death', respawn: 'respawn',
    checkpoint: 'checkpoint', lap: 'checkpoint', win: 'win', lose: 'lose', ...(opts.map || {}) };
  // a generated sfx tagged with the event wins over the default built-in name
  const play = (name, o, ev) => { const tagged = ev && byEvent(game, ev); if (tagged && tagged.length) sfx(game, tagged[Math.floor(Math.random() * tagged.length)], o); else if (name) sfx(game, name, o); };
  const offs = [];
  const on = (ev, fn) => offs.push(game.on(ev, (...a) => { try { fn(...a); } catch (e) { reportError(e); } }));
  on('collect', (item) => {
    const tag = item && (item.tag || item.kind || item.type);
    // prefer a generated sfx named after the tag (gem, star, key...), then the 'collect'/'coin' asset, then built-in
    const name = tag && (game.asset(tag) || game.asset('sfx_' + tag)) ? tag : (game.asset('collect') || game.asset('sfx_collect')) ? 'collect' : (SYNTH[tag] ? tag : map.collect);
    play(name, { pitchVariation: 0.03, volume: 0.9 }, tag && (game.asset(tag) || game.asset('sfx_' + tag)) ? null : 'collect');
  });
  on('jump', () => play(map.jump, { volume: 0.7, pitchVariation: 0.08 }, 'jump'));
  on('land', (p, speed) => { const s = Math.abs(+speed || 6); if (s > 3) play(map.land, { volume: Math.min(1, 0.25 + s / 22), pitchVariation: 0.1, minGap: 0.15 }, 'land'); });
  on('boost', () => play(map.boost, {}, 'boost'));
  on('damage', () => play(map.damage, { pitchVariation: 0.1 }, 'damage'));
  on('death', () => play(map.death, {}, 'death'));
  on('respawn', () => play(map.respawn, { volume: 0.7 }));
  on('checkpoint', () => play(map.checkpoint, {}, 'checkpoint'));
  on('goal', () => play('powerup', {}, 'goal'));
  on('lap', () => play(map.lap, { rate: 1.12 }));
  // a generated cutscene (cutscene.js) brings its own audio: duck the music under it, skip the win/lose stinger
  let inCut = false;
  // a win / lose clip is about to play (cutscene.js starts it ~0.3 s after the event): its own audio replaces the stinger
  const cutFor = (when) => { const m = game.assets && game.assets.manifest; return !!(m && !game.__cutscenes?.disabled && Object.values(m).some(e => e && e.kind === 'cutscene' && e.when === when)); };
  game.__audioMuted = () => muted;
  on('cutscene', (when, phase) => { inCut = phase === 'start'; duck(inCut, { freq: 1200, gain: 0.12 }); });
  on('win', () => { if (inCut || (game.state && game.state.cutscene) || cutFor('win')) return; duck(true, { freq: 2500, gain: 0.35 }); play(map.win, {}, 'win'); setTimeout(() => duck(false), 2600); });
  on('lose', () => { if (inCut || (game.state && game.state.cutscene) || cutFor('lose')) return; duck(true, { freq: 900, gain: 0.4 }); play(map.lose, {}, 'lose'); });
  on('pause', (b) => duck(!!b));
  on('ui', (e) => { const t = e && (e.type || e); if (t === 'click') play('click', { volume: 0.7 }); else if (t === 'hover') play('hover', { minGap: 0.06 }); else if (t === 'countdown') play('tick'); else if (t === 'go') play('go'); else if (t === 'banner') play('banner', { volume: 0.6 }); else if (t === 'open') play('open', { volume: 0.6 }); else if (t === 'star') play('gem', { rate: 0.9 + 0.12 * ((e && e.n) || 1), pitchVariation: 0 }); else if (t === 'type') play('hover', { volume: 0.5, minGap: 0.05, pitchVariation: 0.15 }); else if (t === 'start') play(null, {}, 'start'); });
  if (opts.music !== false && !current) {
    const url = opts.music || game.asset('music_main') || game.asset('music') || null;
    if (url || opts.proceduralMusic) music(game, url, { style: opts.musicStyle });
  }
  const handle = { stop() { offs.forEach(f => f && f()); game.__audioAuto = null; } };
  game.__audioAuto = handle;
  return handle;
}
