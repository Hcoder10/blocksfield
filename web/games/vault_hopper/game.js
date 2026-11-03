import * as K from 'kit';
import { scenery } from './scenery.js';

// Vault Hopper: A fox heists a floating sky vault — colour keys, moving platforms, lava floors.
const game = await K.createGame({ assets: './assets/assets.json', seed: 449, title: "Vault Hopper" });
K.Look.apply(game, "sunset", {
  sun: { elevation: 9, azimuth: 40, intensity: 2.8, color: "#ffb060" },   // low warm golden-hour sun
  fog: { near: 0.25, far: 0.95 },                                          // misty haze at the base of the islands
  bloom: { strength: 0.45, radius: 0.6, threshold: 1.15 },                // let the gold glow
  grade: { saturation: 1.12, contrast: 1.05, vignette: 0.35 },
});
K.Assets.sky(game, 'sky');                 // generated golden-hour panorama; pops in when loaded
const level = K.Level.build(game, "sky_islands", { size: "medium", seed: 449, collectibles: 24 });
const player = K.Player.create(game, { type: "platformer", spawn: level.spawn, yaw: level.spawnYaw, character: {"species": "fox", "accessory": "scarf"}, colors: {"scarf": "#3fd0c9"} });
K.Camera.follow(game, player);
scenery(game, level);                     // generated props + splat landmarks (scenery.js)
const rules = K.Gameplay.rules(game, {level, player, "collect": {"tag": "coin", "target": 15, "label": "Coins"}, "goal": true, "timer": false, "lives": 3, "enemies": 2});
K.UI.hud(game, {"counters": [{"id": "collected", "icon": K.Assets.icon('coin', game), "label": "Coins", "target": 15}], "timer": false, "lives": true, "minimap": true, "objective": "Steal 15 coins, crack the vault, reach the arch", "style": "fantasy", "winScreen": {"title": "VAULT CRACKED!", "subtitle": "The fox got away with the gold"}, "loseScreen": {"title": "HEIST FAILED", "subtitle": "The vault got the better of the fox"}});
K.UI.titleScreen(game, {"title": "Vault Hopper", "subtitle": "Crack the sky vault: colour keys, moving platforms, lava floors", "start": "Press Space", "credit": "WASD / arrows: run \u00b7 Space: jump (again in the air: double jump) \u00b7 Shift: dash / long jump", "countdown": false});   // not awaited: it pauses the game until a key
// keyring HUD for the red and blue vault keys
K.UI.keyring(game, ["red", "blue"]);
// signature mechanics (K.Mechanics, after Gameplay.rules)
const ALONG = (f) => { const r = level.route, i = Math.min(r.length - 2, Math.max(0, Math.floor(f * (r.length - 1)))), a = r[i], b = r[i + 1]; return { p: [a.x, a.y, a.z], yaw: Math.atan2(b.x - a.x, b.z - a.z) }; };
// mechanic: Colour Keys (keys_doors): Grab a colour key to open its matching vault door.
{ const k = ALONG(0.12), d = ALONG(0.25); K.Mechanics.add(game, { type: 'key', color: "red", position: k.p }); K.Mechanics.add(game, { type: 'door', id: "door_red", color: "red", position: d.p, yaw: d.yaw, width: 6 }); }
{ const k = ALONG(0.37), d = ALONG(0.50); K.Mechanics.add(game, { type: 'key', color: "blue", position: k.p }); K.Mechanics.add(game, { type: 'door', id: "door_blue", color: "blue", position: d.p, yaw: d.yaw, width: 6 }); }
// mechanic: Switch & Bridge (switch_gate): Flip the brass switch to raise the platform bridge across the cloud gap.
{ const s = ALONG(0.35), g = ALONG(0.55); K.Mechanics.add(game, { type: 'door', id: 'gate_1', position: g.p, yaw: g.yaw, width: 6 }); K.Mechanics.add(game, { type: 'switch', id: 'switch_1', position: s.p, targets: ['gate_1'] }); }
// mechanic: Lava Surge (rule): Every 5th coin turns the floor to lava for 3 seconds — keep moving!
K.Mechanics.rule(game, { name: "Lava Surge", text: "Every 5th coin turns the floor to lava for 3 seconds \u2014 keep moving!", when: "collect", tag: "coin", every: 5, do: [{ lava: 3 }, { banner: "FLOOR IS LAVA!" }] });
// twist: Heist Heat (rule) — every 30 s the vault guards close in: a chaser spawns at your heels.
K.Mechanics.rule(game, { name: "Heist Heat", text: "Every 30 s the vault guards close in — a chaser spawns behind you!", when: "timer", every: 30, do: [{ spawn: "enemy:chase", at: "player", count: 1 }, { banner: "GUARDS INBOUND!" }, { sfx: "whoosh" }] });
// twist: Vault Jackpot (rule) — clear the vault with all 24 coins and the register goes cha-ching.
K.Mechanics.rule(game, { name: "Vault Jackpot", text: "Grab all 24 coins for a +50 jackpot!", when: "state", key: "collected", gte: 24, do: [{ score: 50 }, { banner: "VAULT JACKPOT! +50" }, { sfx: "win" }] });
// stomp a guard -> bonus points
K.Mechanics.rule(game, { name: "Stomp Bonus", text: "Stomp the guards for +20!", when: "defeat", do: [{ score: 20 }, { toast: "Stomped! +20" }] });
K.FX.auto(game);
K.Audio.auto(game);
K.Audio.music(game, 'music_main');   // heist jazz-funk loop
// plan features: dash-breakable gold crates along the route + a magnet pickup
for (const f of [0.2, 0.44, 0.62, 0.78]) { const c = ALONG(f); K.Mechanics.add(game, { type: 'crate', position: c.p, drops: 'coin', count: 3 }); }
K.Mechanics.powerup(game, { type: 'magnet', position: ALONG(0.68).p, duration: 12 });
game.on('checkpoint', () => K.Audio.sfx(game, 'sfx_checkpoint'));
// plan FX moments
game.on('door', (door, info) => {
  if (info && info.open) {
    K.FX.confetti(game, door, { count: 160, colors: ['#ffd23f', '#ff7a2f', '#ffffff', '#3fd0c9'] });
    K.FX.starBurst(game, door, { color: '#ffd23f', scale: 1.6 });
    K.FX.shake(game, 0.3);
  }
});
game.on('collect', (item) => {
  if (item && item.tag === 'coin') K.FX.sparkle(game, item, { color: '#ffd23f' });
  if (item && item.tag === 'key') K.FX.starBurst(game, item, { color: '#ffd23f', scale: 1.4 });
});
game.on('rule', (r) => {
  if (r && r.name === 'Lava Surge') { K.FX.flash(game, '#ff3b1f', { opacity: 0.35, duration: 0.5, vignette: true }); K.FX.shake(game, 0.4); }
});
game.on('stomp', (p, e) => { K.FX.burst(game, e, { count: 30, speed: 8, color: ['#7ed957', '#b6ff5e', '#ffffff'], shape: 'star' }); K.FX.text(game, e, '+20', { color: '#b6ff5e' }); });
// heist dressing: piles of gold coins on the islands and a glittering hoard at the vault
{
  const g = level.goal.position;
  for (let i = 0; i < 10; i++) {
    const a = i * 0.63, r = 2.2 + (i % 3) * 1.1;
    K.World.prop(game, 'chest', { position: [g.x + Math.cos(a) * r, g.y, g.z + Math.sin(a) * r], yaw: a, scale: 0.8 + (i % 3) * 0.25 });
  }
  K.FX.sparkles(game, [g.x, g.y + 1.2, g.z], { color: '#ffd23f', radius: 4.5, rate: 26 });
  for (const f of [0.2, 0.44, 0.62, 0.78]) {
    const c = ALONG(f);
    K.World.prop(game, 'chest', { position: [c.p[0] + 2.4, c.p[1], c.p[2] - 1.6], yaw: c.yaw, scale: 0.7 });
    K.World.prop(game, 'chest', { position: [c.p[0] - 2.6, c.p[1], c.p[2] + 1.4], yaw: c.yaw + 1.2, scale: 0.55 });
  }
}
// warm rim light on the hero so the fox pops against the golden haze
K.FX.trail(game, player.object, { color: '#ffd23f', colorEnd: '#ff7a2f', width: 0.35, length: 10, offset: [0, 0.9, 0] });
K.Debug.install(game, { level, player });
game.start();
