// ThreeKit core: the game object every other kit module hangs off. See CONTRACT.md.
import * as THREE from 'three';
import RAPIER from '../vendor/rapier/rapier.mjs';

let rapierReady = null;

export async function createGame(opts = {}) {
  const {
    canvas = null,
    parent = document.body,
    seed = 1,
    pixelRatio = Math.min(window.devicePixelRatio || 1, 2),
    assets = null,          // url of assets.json written by the pipeline (generated sky, icons, music, sfx, props)
    title = document.title,
  } = opts;

  rapierReady = rapierReady || RAPIER.init();
  await rapierReady;

  const renderer = new THREE.WebGLRenderer({ canvas: canvas || undefined, antialias: false, powerPreference: 'high-performance',
    preserveDrawingBuffer: true });
  renderer.setPixelRatio(pixelRatio);
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  if (!canvas) parent.appendChild(renderer.domElement);
  renderer.domElement.style.display = 'block';

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 4000);
  camera.position.set(0, 20, 40);

  const world = new RAPIER.World({ x: 0, y: -30, z: 0 });

  const listeners = new Map();
  const updates = [];        // [{fn, order}] called every frame with (dt, t)
  const lateUpdates = [];
  let rng = mulberry32(seed);

  const game = {
    THREE, RAPIER, renderer, scene, camera, world, title,
    clock: { last: 0, start() { this.last = performance.now(); }, getDelta() { const n = performance.now(); const d = (n - this.last) / 1000; this.last = n; return d; } },
    time: 0, dt: 0, timeScale: 1, paused: false, frame: 0,
    composer: null,          // set by Look.apply (EffectComposer); render() falls back to renderer.render
    assets: { manifest: null, base: '' },
    state: {},               // free-form game state (score, lives...), exposed through __kit.state()
    cameraOverride: null,    // {position: Vector3, target: Vector3} while a debug/survey camera holds the view
    rand: () => rng(),
    reseed(s) { rng = mulberry32(s); },
    on(name, fn) { (listeners.get(name) || listeners.set(name, []).get(name)).push(fn); return () => game.off(name, fn); },
    off(name, fn) { const l = listeners.get(name); if (l) l.splice(l.indexOf(fn) >>> 0, 1); },
    emit(name, ...args) { for (const fn of [...(listeners.get(name) || [])]) { try { fn(...args); } catch (e) { reportError(e); } } },
    update(fn, order = 0) { updates.push({ fn, order }); updates.sort((a, b) => a.order - b.order); return fn; },
    lateUpdate(fn, order = 0) { lateUpdates.push({ fn, order }); lateUpdates.sort((a, b) => a.order - b.order); return fn; },
    removeUpdate(fn) { for (const l of [updates, lateUpdates]) { const i = l.findIndex(u => u.fn === fn); if (i >= 0) l.splice(i, 1); } },
    render() { if (game.composer) game.composer.render(game.dt); else renderer.render(scene, camera); },
    start() {
      if (game.started) return game;
      game.started = true;
      game.clock.start();
      renderer.setAnimationLoop(tick);
      game.emit('start');
      return game;
    },
    asset(name) { const m = game.assets.manifest; return m && m[name] ? game.assets.base + m[name].file : null; },
  };

  if (assets) {
    try {
      const r = await fetch(assets);
      game.assets.manifest = r.ok ? await r.json() : null;
      game.assets.base = assets.replace(/[^/]*$/, '');
    } catch (e) { reportError(e); }
  }

  function tick() {
    const raw = Math.min(game.clock.getDelta(), 1 / 20);
    const dt = game.paused ? 0 : raw * game.timeScale;
    game.dt = dt; game.time += dt; game.frame++;
    if (dt > 0) {
      for (const u of updates) { try { u.fn(dt, game.time); } catch (e) { reportError(e); } }
      world.timestep = dt;
      try { world.step(); } catch (e) { reportError(e); }
      game.emit('physics', dt);
    }
    for (const u of lateUpdates) { try { u.fn(dt, game.time); } catch (e) { reportError(e); } }
    if (game.cameraOverride) {
      camera.position.copy(game.cameraOverride.position);
      camera.lookAt(game.cameraOverride.target);
    }
    game.render();
  }

  window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
    if (game.composer) game.composer.setSize(window.innerWidth, window.innerHeight);
    game.emit('resize');
  });

  window.__game = game;
  return game;
}

// errors go to the console (the harness collects them) and to __kit.errors
const seen = new Set();
export function reportError(e) {
  const msg = (e && (e.stack || e.message)) || String(e);
  const key = msg.slice(0, 300);
  if (seen.has(key)) return;
  seen.add(key);
  (window.__kitErrors = window.__kitErrors || []).push(msg.slice(0, 2000));
  console.error('[kit]', msg);
}

export function mulberry32(a) {
  return function () {
    a |= 0; a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

export { THREE, RAPIER };
