# Physics (physics.js)

Thin helpers over Rapier (`game.world`, gravity -30, stepped by core every frame). Level.build already makes the
level colliders; use these for things your game adds. Characters use Rapier's character controller (player.js), not
dynamic bodies.

```js
Physics.addStatic(game, objectOrMeshOrGeometry, { shape = 'auto', friction = 0.6, restitution = 0, sensor = false }) -> colliders[]
Physics.box(game, center, halfExtents, { yaw }) -> collider                    // invisible wall / floor
Physics.heightfield(game, { heights, rows, cols, size: {x, z}, position }) -> collider
Physics.addKinematic(game, mesh, { shape }) -> mover   // collider follows the mesh you animate; riders are carried
Physics.sensor(game, shape, position, onEnter, { onExit, once, targets }) -> sensor   // trigger volume
Physics.raycast(game, from, dir, maxDist = 100, { excludeCollider }) -> { point, normal, distance, object, kinematic } | null
Physics.groundAt(game, x, z, fromY = 200) -> height | null
Physics.removeColliders(game, colliders)
Physics.GROUP / Physics.GROUPS / Physics.groups(member, filter)   // collision groups: world, player, enemy, pickup, sensor, vehicle
```

- `shape`: `'auto'` (BoxGeometry -> `'cuboid'`, everything else -> `'trimesh'`), `'trimesh'` (exact, static only),
  `'convex'` (hull), `'cuboid'` (oriented box from the bounding box), `'ball'`.
- `addStatic` bakes world matrices **now**: position/rotate/scale the object and add it to the scene first. It walks
  every mesh under the object (InstancedMesh instances too); set `mesh.userData.noCollide = true` to skip a mesh.
- Sensor `shape`: a radius number, `{ radius }`, `{ box: [hx, hy, hz] }` or `{ size: Vector3 }` (full size). Sensors
  test against every player (and `targets`) each frame; `onEnter(player)` fires once per entry.

## Examples

```js
const crate = new THREE.Mesh(new THREE.BoxGeometry(2, 2, 2), K.Look.material(game, { color: '#c98' }));
crate.position.set(4, 1, 10); game.scene.add(crate);
K.Physics.addStatic(game, crate);                                   // solid crate

const lift = new THREE.Mesh(new THREE.BoxGeometry(4, 0.6, 4), K.Look.material(game, { color: 'accent' }));
lift.position.set(0, 2, 20); game.scene.add(lift);
K.Physics.addKinematic(game, lift);
game.update((dt, t) => { lift.position.y = 2 + Math.sin(t) * 3; }, 10);   // animate the mesh; collider + riders follow

K.Physics.sensor(game, 3, new THREE.Vector3(0, 1, 40), (p) => rules.win(), { once: true });   // rules = Gameplay.rules(...)
const hit = K.Physics.raycast(game, player.center, new THREE.Vector3(0, -1, 0), 10);
```

## Common mistakes

- Moving a mesh after `addStatic` does not move its collider: use `addKinematic` for anything that moves.
- Level movers in `level.movers` are animated by `Gameplay.rules`; don't add colliders for them yourself.
- Don't create dynamic rigid bodies for the player; Player.create already owns the controller.
- Units: the player is 1.8 tall and jumps 4.5; a "small step" is under 0.55.
