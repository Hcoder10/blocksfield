// physics.js: Rapier helpers (static colliders from meshes, heightfields, kinematic movers, sensors, raycasts).
// See CONTRACT.md and docs/Physics.md. Units are metres-ish: the player is ~1.6 tall, runs at 12 u/s.
import * as THREE from 'three';

// Collision groups: membership bits (high 16) + filter bits (low 16), as Rapier packs them.
export const GROUP = { world: 1, player: 2, enemy: 4, pickup: 8, sensor: 16, vehicle: 32, all: 0xffff };
export function groups(member, filter = GROUP.all) { return ((member & 0xffff) << 16) | (filter & 0xffff); }
export const GROUPS = {
  world: groups(GROUP.world, GROUP.all),
  player: groups(GROUP.player, GROUP.world | GROUP.enemy),
  enemy: groups(GROUP.enemy, GROUP.world | GROUP.player),
  pickup: groups(GROUP.pickup, 0),
  // what character controllers and the camera collide with: the world only
  solidOnly: groups(GROUP.all, GROUP.world),
};

const _v = new THREE.Vector3(), _q = new THREE.Quaternion(), _s = new THREE.Vector3(), _m = new THREE.Matrix4();

function need(game, fn) {
  if (!game || !game.world || !game.RAPIER) throw new Error(`Physics.${fn}: first argument must be the game from createGame()`);
}

function meshesOf(obj) {
  const out = [];
  if (obj && obj.isBufferGeometry) return out;
  obj.updateWorldMatrix(true, true);
  obj.traverse(o => { if (o.isMesh && o.geometry && !o.userData.noCollide && !o.isSprite) out.push(o); });
  return out;
}

// world-space vertices and indices of a geometry under matrix m (instanced meshes expand every instance)
function bake(geom, m) {
  const pos = geom.attributes.position;
  const verts = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    _v.fromBufferAttribute(pos, i).applyMatrix4(m);
    verts[i * 3] = _v.x; verts[i * 3 + 1] = _v.y; verts[i * 3 + 2] = _v.z;
  }
  let idx;
  if (geom.index) idx = new Uint32Array(geom.index.array);
  else { idx = new Uint32Array(pos.count); for (let i = 0; i < pos.count; i++) idx[i] = i; }
  return { verts, idx };
}

function isBoxy(geom) {
  return geom.type === 'BoxGeometry' || geom.type === 'BoxBufferGeometry';
}

function applyOpts(desc, opts) {
  desc.setFriction(opts.friction ?? 0.6);
  desc.setRestitution(opts.restitution ?? 0);
  desc.setCollisionGroups(opts.groups ?? GROUPS.world);
  if (opts.sensor) desc.setSensor(true);
  return desc;
}

function colliderDescFor(game, geom, m, shape) {
  const R = game.RAPIER;
  if (!geom.boundingBox) geom.computeBoundingBox();
  if (shape === 'auto') shape = isBoxy(geom) ? 'cuboid' : (geom.attributes.position.count > 2000 ? 'trimesh' : 'trimesh');
  if (shape === 'cuboid' || shape === 'box') {
    m.decompose(_v, _q, _s);
    const bb = geom.boundingBox, c = bb.getCenter(new THREE.Vector3()), h = bb.getSize(new THREE.Vector3()).multiply(_s).multiplyScalar(0.5);
    c.multiply(_s).applyQuaternion(_q).add(_v);
    return R.ColliderDesc.cuboid(Math.max(h.x, 0.01), Math.max(h.y, 0.01), Math.max(h.z, 0.01))
      .setTranslation(c.x, c.y, c.z).setRotation({ x: _q.x, y: _q.y, z: _q.z, w: _q.w });
  }
  if (shape === 'ball' || shape === 'sphere') {
    m.decompose(_v, _q, _s);
    if (!geom.boundingSphere) geom.computeBoundingSphere();
    const bs = geom.boundingSphere, c = bs.center.clone().applyMatrix4(m);
    return R.ColliderDesc.ball(bs.radius * Math.max(_s.x, _s.y, _s.z)).setTranslation(c.x, c.y, c.z);
  }
  const { verts, idx } = bake(geom, m);
  if (shape === 'convex' || shape === 'hull') {
    const d = R.ColliderDesc.convexHull(verts);
    if (d) return d;
  }
  return R.ColliderDesc.trimesh(verts, idx);
}

/**
 * Static (fixed) colliders for an Object3D (every mesh under it), a Mesh, or a BufferGeometry.
 * opts: { shape: 'auto'|'trimesh'|'convex'|'cuboid'|'ball' (auto: boxes -> cuboid, else trimesh),
 *         friction=0.6, restitution=0, groups, sensor=false, matrix (for a bare geometry) }
 * Returns an array of colliders. Bakes the world matrix NOW: position the object first.
 */
export function addStatic(game, obj, opts = {}) {
  need(game, 'addStatic');
  if (!obj) throw new Error('Physics.addStatic(game, objectOrGeometry, opts): object is missing');
  const R = game.RAPIER, world = game.world;
  const body = world.createRigidBody(R.RigidBodyDesc.fixed());
  const out = [];
  const shape = opts.shape || 'auto';
  if (obj.isBufferGeometry) {
    out.push(world.createCollider(applyOpts(colliderDescFor(game, obj, opts.matrix || new THREE.Matrix4(), shape), opts), body));
  } else {
    for (const mesh of meshesOf(obj)) {
      if (mesh.isInstancedMesh) {
        for (let i = 0; i < mesh.count; i++) {
          mesh.getMatrixAt(i, _m);
          const m = _m.clone().premultiply(mesh.matrixWorld);
          out.push(world.createCollider(applyOpts(colliderDescFor(game, mesh.geometry, m, shape), opts), body));
        }
      } else {
        out.push(world.createCollider(applyOpts(colliderDescFor(game, mesh.geometry, mesh.matrixWorld, shape), opts), body));
      }
    }
  }
  for (const c of out) c.__kit = { static: true, object: obj };
  return out;
}

/** A box collider without a mesh: Physics.box(game, center Vector3, halfExtents Vector3|[x,y,z], {yaw}) */
export function box(game, center, half, opts = {}) {
  need(game, 'box');
  const R = game.RAPIER;
  const h = Array.isArray(half) ? half : [half.x, half.y, half.z];
  const body = game.world.createRigidBody(R.RigidBodyDesc.fixed().setTranslation(center.x, center.y, center.z));
  if (opts.yaw) { _q.setFromAxisAngle(_v.set(0, 1, 0), opts.yaw); body.setRotation({ x: _q.x, y: _q.y, z: _q.z, w: _q.w }, false); }
  return game.world.createCollider(applyOpts(R.ColliderDesc.cuboid(h[0], h[1], h[2]), opts), body);
}

/**
 * Heightfield collider. heights: Float32Array of (rows+1)*(cols+1) values, row-major in Z then X
 * (heights[z*(cols+1)+x]); size: {x, z} world extent; position: centre Vector3 (default origin).
 * Physics.heightfield(game, { heights, rows, cols, size:{x:200,z:200}, position })
 */
export function heightfield(game, opts = {}) {
  need(game, 'heightfield');
  const { heights, rows, cols, size = { x: 100, z: 100 }, position = new THREE.Vector3() } = opts;
  if (!heights || !rows || !cols || heights.length !== (rows + 1) * (cols + 1))
    throw new Error('Physics.heightfield: need {heights, rows, cols} with heights.length === (rows+1)*(cols+1)');
  const R = game.RAPIER;
  // Rapier wants column-major (heights[x*(rows+1)+z]); convert from row-major z*(cols+1)+x
  const hm = new Float32Array(heights.length);
  for (let z = 0; z <= rows; z++) for (let x = 0; x <= cols; x++) hm[x * (rows + 1) + z] = heights[z * (cols + 1) + x];
  const body = game.world.createRigidBody(R.RigidBodyDesc.fixed().setTranslation(position.x, position.y, position.z));
  const c = game.world.createCollider(applyOpts(R.ColliderDesc.heightfield(rows, cols, hm, { x: size.x, y: 1, z: size.z }), opts), body);
  c.__kit = { static: true };
  return c;
}

// ---- kinematic movers -------------------------------------------------------------------------------------------

function kinRegistry(game) {
  if (game.__kinematics) return game.__kinematics;
  const list = game.__kinematics = [];
  // after gameplay (10) moved the meshes: push poses to Rapier before world.step
  game.update(() => {
    for (const k of list) k.sync();
  }, 15);
  return list;
}

/**
 * Kinematic collider that follows a mesh you animate (moving / rotating platforms, spinning bars).
 * Characters standing on it are carried (position and yaw). opts: { shape: 'cuboid'|'trimesh'|'convex'|'auto', friction }
 * Returns { body, colliders, mesh, delta(point) }. Animate mesh.position / rotation; the collider follows each frame.
 */
export function addKinematic(game, mesh, opts = {}) {
  need(game, 'addKinematic');
  if (!mesh || !mesh.isObject3D) throw new Error('Physics.addKinematic(game, mesh, opts): mesh must be a THREE.Object3D');
  if (mesh.userData.kinematic) return mesh.userData.kinematic;
  const R = game.RAPIER, world = game.world;
  mesh.updateWorldMatrix(true, true);
  const p = new THREE.Vector3(), q = new THREE.Quaternion(), s = new THREE.Vector3();
  mesh.matrixWorld.decompose(p, q, s);
  const body = world.createRigidBody(R.RigidBodyDesc.kinematicPositionBased().setTranslation(p.x, p.y, p.z)
    .setRotation({ x: q.x, y: q.y, z: q.z, w: q.w }));
  const inv = new THREE.Matrix4().compose(p, q, new THREE.Vector3(1, 1, 1)).invert();
  const colliders = [];
  const shape = opts.shape || 'auto';
  for (const m of meshesOf(mesh)) {
    const local = m.matrixWorld.clone().premultiply(inv);   // relative to the body (scale baked in)
    colliders.push(world.createCollider(applyOpts(colliderDescFor(game, m.geometry, local, shape), opts), body));
  }
  const prev = new THREE.Matrix4().compose(p, q, new THREE.Vector3(1, 1, 1));
  const cur = prev.clone();
  const k = {
    body, colliders, mesh, prev, cur,
    sync() {
      mesh.updateWorldMatrix(true, false);
      mesh.matrixWorld.decompose(p, q, s);
      prev.copy(cur);
      cur.compose(p, q, new THREE.Vector3(1, 1, 1));
      body.setNextKinematicTranslation({ x: p.x, y: p.y, z: p.z });
      body.setNextKinematicRotation({ x: q.x, y: q.y, z: q.z, w: q.w });
    },
    // where a point riding the mover last frame is now (carry riders)
    carry(point) { return point.clone().applyMatrix4(_m.copy(prev).invert()).applyMatrix4(cur); },
    yawDelta() {
      const a = new THREE.Euler().setFromRotationMatrix(prev, 'YXZ').y, b = new THREE.Euler().setFromRotationMatrix(cur, 'YXZ').y;
      let d = b - a; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI; return d;
    },
  };
  for (const c of colliders) c.__kit = { kinematic: k, object: mesh };
  mesh.userData.kinematic = k;
  kinRegistry(game).push(k);
  return k;
}

export function removeColliders(game, colliders) {
  for (const c of [].concat(colliders || [])) {
    try { const b = c.parent(); game.world.removeCollider(c, true); if (b && b.numColliders() === 0) game.world.removeRigidBody(b); } catch (e) { /* already gone */ }
  }
}

// ---- sensors (geometric, no Rapier events needed) -----------------------------------------------------------------

/** things sensors test against: every player registers itself here (Player.create) */
export function actors(game) { return game.__actors || (game.__actors = []); }

function sensorList(game) {
  if (game.__sensors) return game.__sensors;
  const list = game.__sensors = [];
  game.update(() => {
    for (const s of list) s.test();
  }, 12);
  return list;
}

/**
 * Trigger volume. shape: number (sphere radius) | {radius} | {box:[hx,hy,hz]} | {size: Vector3 (full size)}.
 * onEnter(actor) fires when any player (or opts.targets: array/fn returning objects with .position) enters.
 * opts: { onExit, once=false, yaw }. Returns { position, enabled, remove() }.
 */
export function sensor(game, shape, position, onEnter, opts = {}) {
  need(game, 'sensor');
  if (!position) throw new Error('Physics.sensor(game, shape, position, onEnter): position (Vector3) is missing');
  let r = 1, half = null;
  if (typeof shape === 'number') r = shape;
  else if (shape && shape.box) half = new THREE.Vector3(...shape.box);
  else if (shape && shape.size) half = shape.size.clone().multiplyScalar(0.5);
  else if (shape && shape.radius) r = shape.radius;
  const inside = new Set();
  const s = {
    position: position.clone(), enabled: true, yaw: opts.yaw || 0,
    test() {
      if (!s.enabled) return;
      const targets = typeof opts.targets === 'function' ? opts.targets() : (opts.targets || actors(game));
      for (const a of targets) {
        if (!a || !a.position || a.alive === false) continue;
        const d = _v.copy(a.position).sub(s.position);
        let hit;
        if (half) {
          if (s.yaw) d.applyAxisAngle(_s.set(0, 1, 0), -s.yaw);
          const pr = a.radius || 0.5;
          hit = Math.abs(d.x) < half.x + pr && Math.abs(d.y) < half.y + (a.height || 1.6) * 0.5 && Math.abs(d.z) < half.z + pr;
        } else hit = d.length() < r + (a.radius || 0.5);
        if (hit && !inside.has(a)) { inside.add(a); onEnter && onEnter(a); if (opts.once) { s.remove(); return; } }
        else if (!hit && inside.has(a)) { inside.delete(a); opts.onExit && opts.onExit(a); }
      }
    },
    remove() { const l = sensorList(game); const i = l.indexOf(s); if (i >= 0) l.splice(i, 1); },
  };
  sensorList(game).push(s);
  return s;
}

// ---- queries -----------------------------------------------------------------------------------------------------

/**
 * Physics.raycast(game, from, dir, maxDist=100, {exclude: collider|body, groups, solid=true})
 * -> { point, normal, distance, collider, object } | null. dir need not be normalized.
 */
export function raycast(game, from, dir, maxDist = 100, opts = {}) {
  need(game, 'raycast');
  const R = game.RAPIER;
  const d = _v.copy(dir); const len = d.length(); if (len < 1e-9) return null; d.divideScalar(len);
  const ray = new R.Ray({ x: from.x, y: from.y, z: from.z }, { x: d.x, y: d.y, z: d.z });
  const exC = opts.exclude && opts.exclude.handle !== undefined && opts.exclude.shape !== undefined ? opts.exclude : opts.excludeCollider;
  const exB = opts.excludeBody;
  const pred = opts.filter ? (c) => opts.filter(c) : undefined;
  const hit = game.world.castRayAndGetNormal(ray, maxDist, opts.solid ?? true, undefined, opts.groups ?? GROUPS.solidOnly, exC, exB, pred);
  if (!hit) return null;
  const t = hit.timeOfImpact ?? hit.toi;
  return {
    distance: t,
    point: new THREE.Vector3(from.x + d.x * t, from.y + d.y * t, from.z + d.z * t),
    normal: new THREE.Vector3(hit.normal.x, hit.normal.y, hit.normal.z),
    collider: hit.collider,
    object: hit.collider && hit.collider.__kit ? hit.collider.__kit.object : null,
    kinematic: hit.collider && hit.collider.__kit ? hit.collider.__kit.kinematic || null : null,
  };
}

/** ground height under (x, z) scanning down from y (default 200), or null */
export function groundAt(game, x, z, fromY = 200, maxDist = 400, opts = {}) {
  const h = raycast(game, new THREE.Vector3(x, fromY, z), new THREE.Vector3(0, -1, 0), maxDist, opts);
  return h ? h.point.y : null;
}
