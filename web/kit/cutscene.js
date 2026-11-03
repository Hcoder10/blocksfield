// cutscene.js: full-screen video cutscenes (LTX-2.5 clips from the pipeline) for intro / win / lose. See docs/Assets.md.
//   Cutscene.play(game, urlOrWhen, { skippable=true, caption, onEnd }) -> Promise<'ended'|'skipped'|'missing'>
//   Cutscene.install(game)  auto-plays manifest entries {"kind":"cutscene","file":"cutscene_win.mp4","when":"win"}:
//     intro once at load (on top of the title screen), win / lose on those events (on top of the win / lose screens).
// Look.apply installs it automatically when the manifest has cutscenes, so games need no code for it.

export const WHENS = ['intro', 'win', 'lose'];

function entries(game) {
  const m = game && game.assets && game.assets.manifest;
  if (!m) return {};
  const out = {};
  for (const [k, e] of Object.entries(m)) {
    if (!e || e.kind !== 'cutscene' || !e.file) continue;
    const when = e.when || (k.match(/intro|win|lose/) || [])[0];
    if (when && !out[when]) out[when] = { ...e, url: game.assets.base + e.file };
  }
  return out;
}

/** Cutscene.has(game, when) -> true if the manifest has a cutscene for intro / win / lose */
export function has(game, when) { return !!entries(game)[when]; }

let active = null;

function colors(game) {
  // the HUD's style colours if the UI kit is up, else the look's palette
  const root = game.__ui && game.__ui.root;
  let ink = '', acc = '', fontFam = '';
  if (root) {
    const cs = getComputedStyle(root);
    ink = cs.getPropertyValue('--tk-ink').trim(); acc = cs.getPropertyValue('--tk-p').trim();
    fontFam = cs.getPropertyValue('--tk-display').trim() || cs.fontFamily;
  }
  const pal = (game.look && game.look.palette) || {};
  return { ink: ink || pal.ui || '#0b1020', acc: acc || pal.uiAccent || '#ffd23c', text: pal.uiText || '#ffffff',
    font: fontFam || 'system-ui, sans-serif', style: (game.__ui && game.__ui.style) || 'arcade' };
}

/**
 * Cutscene.play(game, urlOrWhen, opts) -> Promise. urlOrWhen: a video url, or 'intro' | 'win' | 'lose' (from the manifest).
 * opts: skippable=true (any key, click or tap skips after 0.4 s), caption (text under the video), onEnd(result), volume=1
 */
export function play(game, urlOrWhen, opts = {}) {
  if (!game) throw new Error('Cutscene.play(game, urlOrWhen, opts): first argument must be the game from createGame()');
  const e = WHENS.includes(urlOrWhen) ? entries(game)[urlOrWhen] : null;
  const url = e ? e.url : (WHENS.includes(urlOrWhen) ? null : urlOrWhen);
  if (!url) { opts.onEnd && opts.onEnd('missing'); return Promise.resolve('missing'); }
  if (active) active.finish('skipped');
  const when = e ? urlOrWhen : 'custom';
  const c = colors(game);
  const wrap = document.createElement('div');
  wrap.className = 'kit-cutscene';
  Object.assign(wrap.style, { position: 'fixed', inset: '0', zIndex: '9000', background: '#000', display: 'flex', alignItems: 'center',
    justifyContent: 'center', opacity: '0', transition: 'opacity 0.35s ease', cursor: 'pointer', userSelect: 'none' });
  const v = document.createElement('video');
  v.src = url; v.playsInline = true; v.preload = 'auto'; v.volume = opts.volume ?? 1;
  Object.assign(v.style, { width: '100%', height: '100%', objectFit: 'contain', display: 'block' });
  wrap.appendChild(v);
  // letterbox bars (cinematic 2.2:1 feel over the 16:9 clip) + optional caption + skip hint in the UI style
  for (const top of [true, false]) {
    const bar = document.createElement('div');
    Object.assign(bar.style, { position: 'absolute', left: '0', right: '0', height: '7vh', background: '#000', [top ? 'top' : 'bottom']: '0' });
    wrap.appendChild(bar);
  }
  if (opts.caption ?? (e && e.caption)) {
    const cap = document.createElement('div');
    cap.textContent = opts.caption ?? e.caption;
    Object.assign(cap.style, { position: 'absolute', left: '50%', bottom: '9vh', transform: 'translateX(-50%)', color: c.text,
      font: `700 clamp(16px, 2.4vw, 30px) ${c.font}`, textShadow: '0 2px 6px #000', letterSpacing: '0.02em', textAlign: 'center' });
    wrap.appendChild(cap);
  }
  const skip = document.createElement('div');
  skip.textContent = 'SKIP ▸';
  Object.assign(skip.style, { position: 'absolute', right: '3vw', bottom: '2.2vh', padding: '6px 14px', borderRadius: c.style === 'sleek' || c.style === 'scifi' ? '4px' : '999px',
    background: c.ink, color: c.acc, font: `800 13px ${c.font}`, letterSpacing: '0.12em', opacity: '0', transition: 'opacity 0.4s', border: `2px solid ${c.acc}` });
  if (opts.skippable !== false) wrap.appendChild(skip);
  document.body.appendChild(wrap);

  let done = false, resolveP;
  const t0 = performance.now();
  const prevState = game.state && game.state.cutscene;
  if (game.state) game.state.cutscene = when;
  game.emit && game.emit('cutscene', when, 'start');
  const keyCatch = (ev) => {          // capture phase: the key that skips must not also start / pause the game
    ev.stopImmediatePropagation(); ev.preventDefault();
    if (opts.skippable !== false && performance.now() - t0 > 400) finish('skipped');
  };
  const finish = (result) => {
    if (done) return;
    done = true;
    window.removeEventListener('keydown', keyCatch, true);
    // the key that skipped is still down: swallow its keyup too, then let input through
    const once = (ev) => { ev.stopImmediatePropagation(); window.removeEventListener('keyup', once, true); };
    window.removeEventListener('keyup', swallow, true);
    if (result === 'skipped') { window.addEventListener('keyup', once, true); setTimeout(() => window.removeEventListener('keyup', once, true), 800); }
    wrap.style.opacity = '0';
    setTimeout(() => { v.pause(); v.removeAttribute('src'); v.load(); wrap.remove(); }, 380);
    if (active && active.wrap === wrap) active = null;
    if (game.state) game.state.cutscene = prevState ?? null;
    game.emit && game.emit('cutscene', when, 'end', result);
    opts.onEnd && opts.onEnd(result);
    resolveP(result);
  };
  const swallow = (ev) => { ev.stopImmediatePropagation(); };
  window.addEventListener('keydown', keyCatch, true);
  window.addEventListener('keyup', swallow, true);
  wrap.addEventListener('pointerdown', (ev) => { ev.stopPropagation(); if (opts.skippable !== false && performance.now() - t0 > 400) finish('skipped'); });
  v.addEventListener('ended', () => finish('ended'));
  v.addEventListener('error', () => finish('missing'));
  requestAnimationFrame(() => { wrap.style.opacity = '1'; skip.style.opacity = '0.85'; });
  const p = v.play();
  if (p && p.catch) p.catch(() => { v.muted = true; v.play().catch(() => finish('missing')); });   // autoplay policy: retry muted
  // hard stop: a broken file never traps the player
  setTimeout(() => { if (!done && (v.readyState < 2 || v.paused)) finish('missing'); }, Math.max(4000, (opts.maxSeconds ?? 20) * 1000));
  active = { wrap, finish };
  return new Promise(r => { resolveP = r; });
}

/** Cutscene.install(game, { intro=true, win=true, lose=true }): auto-play the manifest's cutscenes. Idempotent. */
export function install(game, opts = {}) {
  if (!game || game.__cutscenes) return game && game.__cutscenes;
  const found = entries(game);
  const C = game.__cutscenes = { found: Object.keys(found), played: [] };
  if (!C.found.length) return C;
  const go = (when) => { if (C.played.includes(when) || !found[when] || opts[when] === false) return; C.played.push(when); play(game, when); };
  if (found.intro && opts.intro !== false) {
    // after the first rendered frame, so the title screen is already up underneath
    const start = () => requestAnimationFrame(() => requestAnimationFrame(() => go('intro')));
    if (game.started) start(); else game.on('start', start);
  }
  game.on('win', () => setTimeout(() => go('win'), 350));
  game.on('lose', () => setTimeout(() => go('lose'), 250));
  return C;
}
