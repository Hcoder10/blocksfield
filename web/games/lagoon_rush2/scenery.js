// Made by the pipeline: the generated props and splat landmarks of this game. game.js calls
// scenery(game, level) once after Level.build.
import * as K from 'kit';

const PROPS = ["prop_buoy"];
const SPLATS = ["splat_buoy"];

export function scenery(game, level) {
  const route = (level && level.route) || [];
  const beside = (i, dist) => {
    const a = route[i], b = route[i + 1];
    const side = new K.THREE.Vector3(b.z - a.z, 0, a.x - b.x).normalize().multiplyScalar(dist);
    const x = a.x + side.x, z = a.z + side.z, y = K.World.heightAt(game, x, z);
    return y == null || Math.abs(y - a.y) > 3 ? null : [x, y, z];
  };
  if (PROPS.length) for (let i = 3, k = 0; i < route.length - 2; i += 3, k++) {
    const p = beside(i, k % 2 ? 3.5 : -3.5);
    if (p) K.Assets.prop(game, PROPS[k % PROPS.length], { position: p, rotationY: k * 1.3, height: 2.2 + (k % 3) * 0.6, fallback: 'mushroom' });
  }
  if (SPLATS.length) for (let i = 2, k = 0; i < route.length - 1 && k < 6; i += 4) {
    const p = beside(i, k % 2 ? 7 : -7);
    if (!p) continue;
    K.Assets.splat(game, SPLATS[k % SPLATS.length], { position: p, height: 3.5 + (k % 3), rotationY: k * 2.1, fallback: 'tree' });
    k++;
  }
}
