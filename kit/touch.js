// ThreeKit touch: on phones and tablets, a virtual joystick (left) and context buttons (right) drive the player, a
// drag on the right half orbits the camera (or looks around in fps), the title screen starts on a tap, and portrait
// shows a "rotate your phone" hint. Installed by Debug.install / UI.hud, so every game gets it with no game.js change.
// Input goes through player.setInput (analog, every player type); without a player it falls back to KeyboardEvents.
import { uiRoot } from './ui.js';

const BUTTONS = {   // per player type: [label, input] (input: 'jump' | 'action'), first is the big one
  platformer: [['Jump', 'jump'], ['Dash', 'action']],
  topdown: [['Dash', 'action'], ['Jump', 'jump']],
  fps: [['Fire', 'action'], ['Jump', 'jump']],
  kart: [['Drift', 'jump', 'release to boost']],     // karts and boats boost by releasing a charged drift
  boat: [['Drift', 'jump', 'release to boost']],
};
const KEY_FOR = { jump: { code: 'Space', key: ' ' }, action: { code: 'ShiftLeft', key: 'Shift' } };

export function isTouch() {
  try { return matchMedia('(pointer: coarse)').matches || navigator.maxTouchPoints > 0 && matchMedia('(hover: none)').matches; } catch { return false; }
}

export function install(game, opts = {}) {
  if (!game || !game.on) throw new Error('Touch.install(game, {player}): first argument must be the game from createGame()');
  if (game.__touch) { if (opts.player) game.__touch.player = opts.player; return game.__touch; }
  const T = game.__touch = { player: opts.player || null, on: false, el: null, stick: { id: null, x: 0, y: 0 }, held: { jump: false, action: false },
    driving: false, keys: new Set(), look: { id: null, lx: 0, ly: 0 } };
  const activate = () => { if (!T.on) build(game, T); };
  if (opts.force || isTouch()) activate();
  else window.addEventListener('touchstart', activate, { once: true, passive: true });
  return T;
}

function playerOf(game, T) {
  return T.player || game.__player || (window.__kit && window.__kit.game === game && window.__kit.player) || null;
}

function build(game, T) {
  T.on = true;
  const root = uiRoot(game);
  root.classList.add('tk-touch');
  const el = T.el = document.createElement('div');
  el.className = 'tk-touchpad';
  el.innerHTML = `<div class="tk-stick"><div class="tk-stick-base"><i></i><i></i><i></i><i></i><div class="tk-stick-knob"></div></div></div>
    <div class="tk-tbtns"></div>
    <div class="tk-treset" title="Back on track">&#x21BA;</div>
    <div class="tk-rotate"><div class="tk-phone"></div><b>Rotate your phone</b><span>This game plays sideways. Tap to play anyway.</span></div>`;
  root.append(el);
  const stickEl = el.querySelector('.tk-stick'), base = el.querySelector('.tk-stick-base'), knob = el.querySelector('.tk-stick-knob');
  const btnsEl = el.querySelector('.tk-tbtns');
  let btnType = null;
  const makeButtons = () => {
    const pl = playerOf(game, T);
    const type = (pl && pl.type) || 'platformer';
    if (type === btnType) return;
    btnType = type;
    btnsEl.innerHTML = '';
    (BUTTONS[type] || BUTTONS.platformer).forEach(([label, input, sub], i) => {
      const b = document.createElement('div');
      b.className = 'tk-tbtn' + (i === 0 ? ' tk-big' : '');
      b.innerHTML = sub ? `<span>${label}<small>${sub}</small></span>` : label;
      b.addEventListener('pointerdown', (e) => { e.preventDefault(); e.stopPropagation(); b.setPointerCapture && b.setPointerCapture(e.pointerId); T.held[input] = true; b.classList.add('tk-on'); });
      const up = (e) => { T.held[input] = false; b.classList.remove('tk-on'); };
      b.addEventListener('pointerup', up); b.addEventListener('pointercancel', up); b.addEventListener('lostpointercapture', up);
      btnsEl.append(b);
    });
  };
  makeButtons();
  const resetEl = el.querySelector('.tk-treset');
  resetEl.addEventListener('pointerdown', (e) => { e.preventDefault(); e.stopPropagation(); game.emit('assistReset'); resetEl.classList.remove('tk-on'); void resetEl.offsetWidth; resetEl.classList.add('tk-on'); });

  // joystick: appears where the thumb lands inside the left zone (floating stick), springs back on release
  let cx = 0, cy = 0, R = 60;
  stickEl.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    if (T.stick.id !== null) return;
    T.stick.id = e.pointerId; stickEl.setPointerCapture && stickEl.setPointerCapture(e.pointerId);
    const r = stickEl.getBoundingClientRect(), br = base.getBoundingClientRect();
    R = br.width * 0.42;
    cx = Math.min(Math.max(e.clientX, r.left + br.width / 2), r.right - br.width / 2);
    cy = Math.min(Math.max(e.clientY, r.top + br.height / 2), r.bottom - br.height / 2);
    base.style.left = (cx - r.left) + 'px'; base.style.top = (cy - r.top) + 'px';
    stickEl.classList.add('tk-on');
    move(e);
  });
  const move = (e) => {
    if (e.pointerId !== T.stick.id) return;
    let dx = e.clientX - cx, dy = e.clientY - cy;
    const L = Math.hypot(dx, dy);
    if (L > R) { dx *= R / L; dy *= R / L; }
    knob.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
    const k = Math.min(1, L / R);
    const dead = 0.12;
    const s = k < dead ? 0 : (k - dead) / (1 - dead);
    T.stick.x = L ? (dx / L) * s : 0; T.stick.y = L ? (-dy / L) * s : 0;
  };
  stickEl.addEventListener('pointermove', move);
  const release = (e) => {
    if (e.pointerId !== T.stick.id) return;
    T.stick.id = null; T.stick.x = T.stick.y = 0;
    knob.style.transform = 'translate(-50%, -50%)';
    stickEl.classList.remove('tk-on');
    base.style.left = ''; base.style.top = '';
  };
  stickEl.addEventListener('pointerup', release); stickEl.addEventListener('pointercancel', release); stickEl.addEventListener('lostpointercapture', release);

  // right-half drag on the canvas: camera orbit (camera kit reads pointer drags) or fps look (player.lookYaw)
  let nativeMove = false;
  const canvas = game.renderer.domElement;
  canvas.style.touchAction = 'none';
  canvas.addEventListener('pointerdown', (e) => { if (e.pointerType === 'touch' && T.look.id === null) { T.look.id = e.pointerId; T.look.lx = e.clientX; T.look.ly = e.clientY; } });
  window.addEventListener('pointermove', (e) => {
    if (e.pointerId !== T.look.id || !e.isTrusted) return;
    const dx = e.clientX - T.look.lx, dy = e.clientY - T.look.ly;
    T.look.lx = e.clientX; T.look.ly = e.clientY;
    const pl = playerOf(game, T);
    if (pl && pl.type === 'fps') { pl.lookYaw -= dx * 0.006; pl.lookPitch = Math.max(-1.4, Math.min(1.4, (pl.lookPitch || 0) - dy * 0.005)); return; }
    if (e.movementX || e.movementY) { nativeMove = true; return; }
    if (!nativeMove && (dx || dy)) window.dispatchEvent(new PointerEvent('pointermove', { pointerId: e.pointerId, pointerType: 'touch', movementX: dx * 1.4, movementY: dy * 1.4, bubbles: true }));
  }, true);
  const lookEnd = (e) => { if (e.pointerId === T.look.id) T.look.id = null; };
  window.addEventListener('pointerup', lookEnd, true); window.addEventListener('pointercancel', lookEnd, true);

  // rotate hint (portrait); a tap dismisses it for this session
  const rot = el.querySelector('.tk-rotate');
  rot.addEventListener('pointerdown', (e) => { e.stopPropagation(); T.rotateDismissed = true; rot.classList.remove('tk-show'); });
  const orient = () => rot.classList.toggle('tk-show', innerHeight > innerWidth * 1.05 && !T.rotateDismissed);
  addEventListener('resize', orient); orient();

  // feed the player every frame (before the player kit's update at order 0)
  game.update(() => {
    makeButtons();
    const pl = playerOf(game, T);
    const active = T.stick.id !== null || T.held.jump || T.held.action;
    if (pl && typeof pl.setInput === 'function') {
      if (active) { pl.setInput(T.stick.x, T.stick.y, T.held.jump, T.held.action); T.driving = true; }
      else if (T.driving) { pl.setInput(0, 0, false, false); T.driving = false; }
      return;
    }
    // no player object: real key events (thresholded stick)
    const want = new Set();
    if (T.stick.y > 0.35) want.add('KeyW'); if (T.stick.y < -0.35) want.add('KeyS');
    if (T.stick.x > 0.35) want.add('KeyD'); if (T.stick.x < -0.35) want.add('KeyA');
    if (T.held.jump) want.add('Space'); if (T.held.action) want.add('ShiftLeft');
    for (const c of want) if (!T.keys.has(c)) key('keydown', c);
    for (const c of [...T.keys]) if (!want.has(c)) key('keyup', c);
    T.keys = want;
  }, -20);
  // hide the pad while a full screen (title, pause, win/lose, dialog) is up
  game.lateUpdate(() => { const U = game.__ui; el.classList.toggle('tk-off', !!((U && (U.title || U.screen || U.pauseEl || U.counting)) || (game.state && game.state.cutscene))); }, 32);
  game.emit('touch', true);
}

function key(type, code) {
  const key = code === 'Space' ? ' ' : code === 'ShiftLeft' ? 'Shift' : code.slice(3).toLowerCase();
  window.dispatchEvent(new KeyboardEvent(type, { code, key, bubbles: true }));
}
