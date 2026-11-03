// Three composed levels (the same specs as docs/Level.md "Compose your own level").

// 1) Spiral tower climb: pillars spiral up around a tall tower; goal on the top platform.
export const spiral = (() => {
  const pieces = [
    { type: 'island', position: [0, 0, 0], size: 10 },                         // start
    { type: 'island', position: [0, -2, 26], size: 6, route: false },          // the tower's own rock
    { type: 'tower', position: [0, -2, 26], height: 30 },
  ];
  for (let k = 0; k < 11; k++) {
    const a = -Math.PI / 2 + k * 0.62;
    pieces.push({ type: 'pillar', position: [Math.cos(a) * 10, 1.5 + k * 2, 26 + Math.sin(a) * 10], size: k === 10 ? 3.5 : 1.8 });
  }
  return { pieces, goal: true, collectibles: 'along_route' };
})();

// 2) Canyon river run: a flooded canyon floor (the river), mesas and stepping stones above it, a bridge, stairs.
export const canyon = (() => {
  const pieces = [
    { type: 'water', position: [30, -1.6, 38], size: 320 },
    { type: 'cliff', position: [0, 2, 0], size: 8 },                           // start mesa
    { type: 'platform', position: [0, 1, 12.5], size: 2 },                      // stepping stones over the river
    { type: 'platform', position: [4, 1.5, 17.5], size: 2 },
    { type: 'platform', position: [9, 2, 22], size: 2 },
    { type: 'cliff', position: [16, 4, 30], size: 7 },
    { type: 'bridge', from: [20.8, 4, 32.7], to: [29.2, 4.5, 37.3] },
    { type: 'cliff', position: [34, 4.5, 40], size: 7 },
    { type: 'stairs', from: [34, 4.5, 45.5], to: [34, 1, 53] },
    { type: 'platform', position: [34, 1, 56], size: [6, 4, 6] },
    { type: 'pillar', position: [34, 2.5, 63] },
    { type: 'pillar', position: [30, 4.5, 68] },
    { type: 'cliff', position: [22, 6, 76], size: 8 },                          // goal mesa
  ];
  // canyon walls: tall mesas either side of the run (not on the route)
  const spine = [[0, 0], [16, 30], [34, 52], [22, 76]];
  for (let k = 0; k < spine.length; k++) {
    for (const s of [-1, 1]) {
      const [x, z] = spine[k];
      pieces.push({ type: 'cliff', position: [x + s * 22, 11 + (k % 2) * 2, z - s * 6], size: 9, route: false });
    }
  }
  return { ground: { style: 'sand', y: -3, size: 300, hills: 22 }, pieces, goal: true,
    hazards: [{ type: 'spikes', position: [16, 4, 26], size: [1.6, 0.6, 1.6] }] };
})();

// 3) Floating castle: a gate island, stairs up into a walled keep, a bridge to the east tower, pillars to the spire.
export const castle = {
  pieces: [
    { type: 'island', position: [0, 0, 0], size: 9 },                                        // gate island
    { type: 'stairs', from: [0, 0, 6.5], to: [0, 5, 14] },
    { type: 'island', position: [0, 5, 24], size: 12 },                                      // the keep
    { type: 'arch', position: [0, 5, 15], width: 6, height: 5 },
    { type: 'wall', position: [0, 5, 33], length: 16 },
    { type: 'wall', position: [-8.5, 5, 24], length: 16, rotationY: Math.PI / 2 },
    { type: 'wall', position: [8.5, 5, 18.5], length: 7, rotationY: Math.PI / 2 },
    { type: 'tower', position: [-8, 5, 32], height: 11 }, { type: 'tower', position: [8, 5, 32], height: 11 },
    { type: 'tower', position: [-8, 5, 16], height: 9 },
    { type: 'bridge', from: [9.5, 5, 27.2], to: [24.3, 7, 32.1] },
    { type: 'island', position: [30, 7, 34], size: 7 },                                      // east tower island
    { type: 'tower', position: [33, 7, 30], height: 9 },
    { type: 'pillar', position: [31, 9, 45] },
    { type: 'pillar', position: [34, 11, 50.5] },
    { type: 'island', position: [34, 13, 58], size: 6 },                                     // the spire
    { type: 'tower', position: [36, 13, 61], height: 14 },
    { type: 'mover', position: [-12, 5, 24], to: [-26, 7, 30], period: 6, route: false },  // side trip to a bonus island
    { type: 'island', position: [-31, 7, 32], size: 5, route: false },
  ],
  goal: true,
  collectibles: 'along_route',
};

// 4) Ferry crossing: movers ON the route (a raft across the river, a spinning beam, a lift up to the goal).
export const ferry = {
  ground: { style: 'grass', y: -3, size: 260, hills: 16 },
  pieces: [
    { type: 'water', position: [0, -1.6, 30], size: 280 },
    { type: 'cliff', position: [0, 1, 0], size: 8 },                                         // start bank
    { type: 'mover', motion: 'raft', path: [[0, 0, 9.5], [0, 0, 26.5]], period: 9, wait: 1.2 },  // raft across
    { type: 'cliff', position: [0, 1, 36], size: 8 },
    { type: 'pillar', position: [0, 2.5, 47.5] },
    { type: 'mover', motion: 'rotate', position: [0, 3, 54], speed: 0.6, length: 9 },        // spinning beam
    { type: 'pillar', position: [0, 3.5, 60.5] },
    { type: 'platform', position: [0, 4, 66], size: [5, 6, 5] },
    { type: 'mover', path: [[0, 4.3, 71], [0, 12, 78]], period: 7, wait: 1.0 },               // lift
    { type: 'island', position: [0, 12, 86], size: 7 },                                      // goal
  ],
  goal: true,
};

export const all = { spiral, canyon, castle, ferry };
export const looks = { spiral: 'candy', canyon: 'desert', castle: 'dark_fantasy', ferry: 'cozy' };
