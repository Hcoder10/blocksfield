// assets.js: generated assets (ComfyUI skies/icons/textures, Idol splat props) with procedural fallbacks. See docs/Assets.md.
// Nothing here throws on a missing manifest or file: every call falls back to something that looks right.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import * as Look from './look.js';
import * as World from './world.js';

function entry(game, name, kind) {
  const m = game && game.assets && game.assets.manifest;
  if (!m || !name || !m[name]) return null;
  const e = m[name];
  if (kind && e.kind && e.kind !== kind) return null;
  return { ...e, url: game.assets.base + e.file };
}
function gameOf(a) { return a && a.scene ? a : (typeof window !== 'undefined' ? window.__game : null); }

/**
 * Assets.sky(game, name='sky') -> Promise<boolean>. Loads an equirect panorama from the manifest as background + environment.
 * Missing -> keeps the procedural sky from Look.apply and resolves false.
 */
export async function sky(game, name = 'sky', opts = {}) {
  const e = entry(game, name, 'sky');
  if (!e) return false;
  try {
    const tex = await new THREE.TextureLoader().loadAsync(e.url);
    tex.mapping = THREE.EquirectangularReflectionMapping;
    tex.colorSpace = THREE.SRGBColorSpace;
    game.scene.background = tex;
    game.scene.backgroundIntensity = opts.intensity ?? 1;
    const pm = new THREE.PMREMGenerator(game.renderer);
    const env = pm.fromEquirectangular(tex);
    game.scene.environment = env.texture;
    pm.dispose();
    if (game.look && game.look.sky) game.look.sky.visible = false;
    if (game.scene.fog && opts.fogFromSky !== false) {
      // match fog to the panorama horizon so distant land melts into it
      try {
        const c = sampleHorizon(tex.image);
        if (c) game.scene.fog.color.copy(c);
      } catch { /* cross-origin or no canvas: keep look fog */ }
    }
    return true;
  } catch (err) {
    console.warn(`[kit] Assets.sky: could not load "${name}" (${e.url}); keeping the procedural sky`, err);
    return false;
  }
}
function sampleHorizon(img) {
  if (!img || !img.width) return null;
  const c = document.createElement('canvas'); c.width = 64; c.height = 32;
  const x = c.getContext('2d'); x.drawImage(img, 0, 0, 64, 32);
  const d = x.getImageData(0, 15, 64, 2).data;
  let r = 0, g = 0, b = 0; const n = d.length / 4;
  for (let i = 0; i < d.length; i += 4) { r += d[i]; g += d[i + 1]; b += d[i + 2]; }
  return new THREE.Color().setRGB(r / n / 255, g / n / 255, b / n / 255, THREE.SRGBColorSpace);
}

// ------------------------------------------------------------------------------------------------ icons
const iconCache = new Map();
const ICONS = ['coin', 'gem', 'star', 'heart', 'key', 'clock', 'flag', 'trophy', 'bolt', 'skull', 'shield', 'leaf', 'fish', 'mushroom', 'crown', 'lap', 'speed'];
/**
 * Assets.icon(name, game?) -> image url (string). Manifest icon if present, otherwise a drawn icon for common names:
 * coin gem star heart key clock flag trophy bolt skull shield leaf fish mushroom crown lap speed (anything else -> a coloured badge).
 */
export function icon(name, game) {
  game = gameOf(game);
  const e = entry(game, name, 'icon');
  if (e) return e.url;
  const pal = Look.palette(game);
  const key = name + ':' + (game && game.look ? game.look.name : '');
  if (iconCache.has(key)) return iconCache.get(key);
  const S = 128, c = document.createElement('canvas'); c.width = c.height = S;
  const x = c.getContext('2d');
  x.lineJoin = 'round'; x.lineCap = 'round';
  const fill = (col, path) => { x.fillStyle = col; x.fill(path); };
  const outline = (path, w = 8) => { x.lineWidth = w; x.strokeStyle = 'rgba(20,16,40,0.9)'; x.stroke(path); };
  const grad = (a, b) => { const g = x.createLinearGradient(0, 16, 0, 112); g.addColorStop(0, a); g.addColorStop(1, b); return g; };
  const shine = () => { x.fillStyle = 'rgba(255,255,255,0.55)'; x.beginPath(); x.ellipse(48, 42, 16, 9, -0.6, 0, Math.PI * 2); x.fill(); };
  const poly = (pts) => { const p = new Path2D(); pts.forEach(([px, py], i) => i ? p.lineTo(px, py) : p.moveTo(px, py)); p.closePath(); return p; };
  const star = (cx, cy, r1, r2, n = 5) => { const pts = []; for (let i = 0; i < n * 2; i++) { const a = -Math.PI / 2 + i * Math.PI / n, r = i % 2 ? r2 : r1; pts.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]); } return poly(pts); };
  const circle = (cx, cy, r) => { const p = new Path2D(); p.arc(cx, cy, r, 0, Math.PI * 2); return p; };
  const n = ICONS.includes(name) ? name : 'badge';
  switch (n) {
    case 'coin': { const p = circle(64, 64, 48); outline(p, 10); fill(grad('#ffe680', '#f0a020'), p); const q = circle(64, 64, 32); x.lineWidth = 6; x.strokeStyle = 'rgba(180,100,0,0.6)'; x.stroke(q); fill('rgba(255,240,160,0.9)', star(64, 66, 18, 8)); shine(); break; }
    case 'gem': { const p = poly([[64, 112], [16, 50], [36, 20], [92, 20], [112, 50]]); outline(p, 10); fill(grad('#9ff6ff', pal.secondary), p); fill('rgba(255,255,255,0.35)', poly([[36, 20], [64, 50], [16, 50]])); fill('rgba(0,0,40,0.2)', poly([[64, 112], [64, 50], [112, 50]])); break; }
    case 'star': { const p = star(64, 68, 54, 24); outline(p, 10); fill(grad('#fff3a0', '#ffb020'), p); shine(); break; }
    case 'heart': { const p = new Path2D('M64 110 C20 80 8 56 20 36 C32 16 56 20 64 40 C72 20 96 16 108 36 C120 56 108 80 64 110 Z'); outline(p, 10); fill(grad('#ff8aa8', pal.danger || '#ff3b5c'), p); shine(); break; }
    case 'key': { const p = new Path2D(); p.arc(40, 50, 24, 0, Math.PI * 2); p.rect(56, 44, 54, 14); p.rect(88, 56, 10, 18); p.rect(102, 56, 8, 14); outline(p, 10); fill(grad('#ffe680', '#e09a20'), p); fill('rgba(40,20,0,0.6)', circle(40, 50, 9)); break; }
    case 'clock': { const p = circle(64, 66, 48); outline(p, 10); fill(grad('#ffffff', '#cfe4ff'), p); x.lineWidth = 8; x.strokeStyle = '#2a2a48'; x.beginPath(); x.moveTo(64, 66); x.lineTo(64, 36); x.moveTo(64, 66); x.lineTo(86, 76); x.stroke(); break; }
    case 'flag': { const p = poly([[34, 18], [104, 34], [34, 62]]); x.lineWidth = 10; x.strokeStyle = '#2a2a48'; x.beginPath(); x.moveTo(34, 14); x.lineTo(34, 114); x.stroke(); outline(p, 8); fill(grad(pal.primary, pal.primary), p); break; }
    case 'trophy': { const p = new Path2D('M36 20 H92 V48 C92 70 78 80 64 80 C50 80 36 70 36 48 Z M56 80 H72 V96 H86 V110 H42 V96 H56 Z'); outline(p, 10); fill(grad('#ffe680', '#e09a20'), p); shine(); break; }
    case 'bolt': { const p = poly([[74, 10], [30, 72], [60, 72], [50, 118], [98, 52], [68, 52]]); outline(p, 10); fill(grad('#fff6a0', '#ffb000'), p); break; }
    case 'skull': { const p = new Path2D('M64 14 C32 14 18 38 22 62 C24 74 32 78 36 84 V104 H92 V84 C96 78 104 74 106 62 C110 38 96 14 64 14 Z'); outline(p, 10); fill(grad('#ffffff', '#d8d0e8'), p); fill('#2a2040', circle(46, 60, 12)); fill('#2a2040', circle(82, 60, 12)); break; }
    case 'shield': { const p = new Path2D('M64 12 L108 28 V60 C108 88 88 106 64 116 C40 106 20 88 20 60 V28 Z'); outline(p, 10); fill(grad(pal.secondary, '#2a5aa0'), p); fill('rgba(255,255,255,0.35)', star(64, 62, 22, 10)); break; }
    case 'leaf': { const p = new Path2D('M20 108 C20 50 50 18 110 18 C110 78 78 108 20 108 Z'); outline(p, 10); fill(grad('#a8f070', '#3a9a3a'), p); x.lineWidth = 5; x.strokeStyle = 'rgba(20,60,20,0.6)'; x.beginPath(); x.moveTo(26, 102); x.lineTo(96, 32); x.stroke(); break; }
    case 'fish': { const p = new Path2D('M14 64 C34 34 74 30 96 56 L118 36 V92 L96 72 C74 98 34 94 14 64 Z'); outline(p, 10); fill(grad('#9fe6ff', '#3a8ad0'), p); fill('#1a2040', circle(38, 58, 6)); break; }
    case 'mushroom': { const p = new Path2D('M16 68 C16 30 112 30 112 68 Z M48 68 H80 V108 H48 Z'); outline(p, 10); fill(grad('#ff7a6a', '#d0302a'), p); fill('#fff', circle(44, 52, 8)); fill('#fff', circle(76, 46, 10)); break; }
    case 'crown': { const p = poly([[16, 100], [16, 36], [42, 62], [64, 22], [86, 62], [112, 36], [112, 100]]); outline(p, 10); fill(grad('#ffe680', '#e09a20'), p); fill(pal.danger || '#ff3b5c', circle(64, 78, 9)); break; }
    case 'lap': { const p = new Path2D(); p.arc(64, 64, 42, 0, Math.PI * 1.6); x.lineWidth = 22; x.strokeStyle = 'rgba(20,16,40,0.9)'; x.stroke(p); x.lineWidth = 12; x.strokeStyle = pal.accent; x.stroke(p); fill(pal.accent, poly([[96, 20], [118, 42], [90, 50]])); break; }
    case 'speed': { for (let i = 0; i < 3; i++) { const p = poly([[24 + i * 28, 24], [56 + i * 28, 64], [24 + i * 28, 104], [40 + i * 28, 104], [72 + i * 28, 64], [40 + i * 28, 24]]); outline(p, 8); fill(pal.accent, p); } break; }
    default: { const p = circle(64, 64, 50); outline(p, 10); fill(grad(pal.primary, pal.secondary), p); x.fillStyle = '#fff'; x.font = 'bold 64px sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText(String(name || '?').slice(0, 1).toUpperCase(), 64, 68); }
  }
  const url = c.toDataURL('image/png');
  iconCache.set(key, url);
  return url;
}

// ------------------------------------------------------------------------------------------------ textures
/**
 * Assets.texture(name, { game, repeat=[1,1], fallback='noise'|'checker'|'grid'|'stripes', color }) -> THREE.Texture
 * Returns immediately; a manifest texture streams in, otherwise a procedural canvas texture.
 */
export function texture(name, opts = {}) {
  const game = gameOf(opts.game);
  const e = entry(game, name, 'texture');
  let tex;
  if (e) {
    tex = new THREE.TextureLoader().load(e.url, undefined, undefined, () => console.warn(`[kit] Assets.texture: failed to load ${e.url}`));
  } else {
    const S = 256, c = document.createElement('canvas'); c.width = c.height = S;
    const x = c.getContext('2d');
    const pal = Look.palette(game);
    const base = opts.color || pal.primary;
    x.fillStyle = base; x.fillRect(0, 0, S, S);
    const kind = opts.fallback || 'noise';
    if (kind === 'checker') { x.fillStyle = 'rgba(0,0,0,0.18)'; for (let i = 0; i < 8; i++) for (let j = 0; j < 8; j++) if ((i + j) % 2) x.fillRect(i * 32, j * 32, 32, 32); }
    else if (kind === 'grid') { x.strokeStyle = 'rgba(0,0,0,0.25)'; x.lineWidth = 4; for (let i = 0; i <= 8; i++) { x.beginPath(); x.moveTo(i * 32, 0); x.lineTo(i * 32, S); x.moveTo(0, i * 32); x.lineTo(S, i * 32); x.stroke(); } }
    else if (kind === 'stripes') { x.fillStyle = 'rgba(255,255,255,0.8)'; for (let i = 0; i < 8; i += 2) x.fillRect(i * 32, 0, 32, S); }
    else { for (let i = 0; i < 1800; i++) { const v = Math.random(); x.fillStyle = v > 0.5 ? 'rgba(255,255,255,0.07)' : 'rgba(0,0,0,0.07)'; x.fillRect(Math.random() * S, Math.random() * S, 3 + Math.random() * 6, 3 + Math.random() * 6); } }
    tex = new THREE.CanvasTexture(c);
  }
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  const r = opts.repeat || [1, 1]; tex.repeat.set(r[0], r[1]);
  tex.anisotropy = 4;
  return tex;
}

/** Assets.music(name, game?) / Assets.sfx(name, game?) -> url or null (Audio kit falls back to procedural sound) */
export function music(name, game) { const e = entry(gameOf(game), name, 'music'); return e ? e.url : null; }
export function sfx(name, game) { const e = entry(gameOf(game), name, 'sfx'); return e ? e.url : null; }
/** Assets.has(game, name) -> true if the manifest has this asset */
export function has(game, name) { return !!entry(gameOf(game), name); }

// ------------------------------------------------------------------------------------------------ Idol splat props (voxels)
const voxCache = new Map();
/**
 * Assets.prop(game, name, { position=[0,0,0], yaw=0, height (target height in units; default: native size * scale), scale=1,
 *   collider=true, fallback='crate' (World.prop kind used if the asset is missing) }) -> THREE.Group (returned at once;
 *   voxels stream in; group.userData.ready is a Promise<boolean> that resolves true when the generated prop is shown).
 * Voxel JSON (written by the pipeline): {"voxel": 0.05, "points": [[x, y, z, r, g, b], ...], "up": "y"} -- see docs/Assets.md.
 */
export function prop(game, name, opts = {}) {
  if (!game || !game.scene) throw new Error('Assets.prop(game, name, opts): first argument must be the game from createGame()');
  const group = new THREE.Group(); group.name = 'kit:asset:' + name;
  const pos = World.v3(opts.position);
  group.position.copy(pos); group.rotation.y = opts.yaw ?? 0;
  (opts.parent || game.scene).add(group);
  const e = entry(game, name, 'prop') || entry(game, name);
  const fallback = () => {
    const kind = World.propKinds.includes(opts.fallback) ? opts.fallback : 'crate';
    const g = World.prop(game, kind, { ...opts, position: pos, parent: group.parent, collider: opts.collider });
    // re-home under our group so the caller's handle moves it
    group.parent.remove(g); g.position.set(0, 0, 0); g.rotation.set(0, 0, 0); group.add(g);
    group.userData.fallback = kind;
    return false;
  };
  if (!e || !/\.json$/i.test(e.file || '')) { group.userData.ready = Promise.resolve(fallback()); return group; }
  group.userData.ready = (async () => {
    try {
      let data = voxCache.get(e.url);
      if (!data) { const r = await fetch(e.url); if (!r.ok) throw new Error('http ' + r.status); data = await r.json(); voxCache.set(e.url, data); }
      buildVoxels(game, group, data, opts);
      return true;
    } catch (err) {
      console.warn(`[kit] Assets.prop: "${name}" (${e.url}) failed, using fallback`, err);
      return fallback();
    }
  })();
  return group;
}

export function buildVoxels(game, group, data, opts = {}) {
  const pts = Array.isArray(data) ? data : (data.points || []);
  if (!pts.length) throw new Error('voxel json has no points');
  const vox = data.voxel || 0.05;
  const zUp = data.up === 'z';
  const max255 = pts.some(p => p[3] > 1 || p[4] > 1 || p[5] > 1);
  const box = new THREE.Box3();
  const P = pts.map(p => { const v = zUp ? new THREE.Vector3(p[0], p[2], -p[1]) : new THREE.Vector3(p[0], p[1], p[2]); box.expandByPoint(v); return v; });
  const size = box.getSize(new THREE.Vector3());
  const ctr = box.getCenter(new THREE.Vector3());
  const k = opts.height ? opts.height / Math.max(size.y, vox) : (opts.scale ?? 1);
  const geo = new RoundedBoxGeometry(vox * 1.02, vox * 1.02, vox * 1.02, 1, vox * 0.18);
  const mat = Look.material(game, { color: '#ffffff', rim: 0.5 });
  const im = new THREE.InstancedMesh(geo, mat, P.length);
  const m = new THREE.Matrix4(), c = new THREE.Color();
  for (let i = 0; i < P.length; i++) {
    const v = P[i];
    m.makeTranslation(v.x - ctr.x, v.y - box.min.y + vox / 2, v.z - ctr.z);
    im.setMatrixAt(i, m);
    const p = pts[i];
    if (max255) c.setRGB(p[3] / 255, p[4] / 255, p[5] / 255, THREE.SRGBColorSpace); else c.setRGB(p[3], p[4], p[5], THREE.SRGBColorSpace);
    im.setColorAt(i, c);
  }
  im.instanceMatrix.needsUpdate = true; if (im.instanceColor) im.instanceColor.needsUpdate = true;
  im.castShadow = true; im.receiveShadow = true;
  im.scale.setScalar(k);
  im.computeBoundingSphere();
  group.add(im);
  group.updateMatrixWorld(true);
  group.userData.size = size.clone().multiplyScalar(k);
  if (opts.collider !== false) {
    const half = size.clone().multiplyScalar(k / 2);
    const cen = new THREE.Vector3(0, half.y, 0).applyMatrix4(group.matrixWorld);
    World.colliderBox(game, cen, half, group.rotation.y, { what: 'asset' });
  }
  return im;
}
