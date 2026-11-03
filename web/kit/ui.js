// ThreeKit UI: a DOM/CSS overlay (HUD, banners, title/pause/win/lose screens, toasts, dialog, countdown) themed by
// a `style` ('arcade' | 'cozy' | 'sleek' | 'fantasy' | 'scifi') and Look.palette(game). The HUD binds to game.state
// on its own and reacts to the CONTRACT events (checkpoint, lap, win, lose, damage, pause). See docs/UI.md.
import * as THREE from 'three';
import { reportError } from './core.js';
import * as Look from './look.js';
import * as Audio from './audio.js';
import { frameBox, survey } from './debug.js';
import * as Touch from './touch.js';
import * as Assist from './assist.js';

export const STYLES = ['arcade', 'cozy', 'sleek', 'fantasy', 'scifi'];
const LOOK_STYLE = { neon_night: 'scifi', cozy: 'cozy', dark_fantasy: 'fantasy', snow: 'sleek', desert: 'arcade', sunset: 'arcade', candy: 'cozy', toon_bright: 'arcade' };

// ---------- tiny DOM helpers ----------
function h(tag, cls, kids, attrs) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (attrs) for (const k in attrs) e.setAttribute(k, attrs[k]);
  for (const k of [].concat(kids ?? [])) if (k != null) e.append(k.nodeType ? k : document.createTextNode(String(k)));
  return e;
}
// big display text: dark underlay (outline + extrusion) with a gradient fill layer and a moving shine
export function bigText(text, cls = '') {
  const t = String(text);
  const e = h('span', 'tk-big ' + cls, [t], { 'data-text': t });
  e.append(h('span', 'tk-fill', [t]));
  return e;
}
const panel = (kids, cls = '') => h('div', 'tk-panel ' + cls, kids);
const wrap = (el, cls = '') => h('div', 'tk-panel-wrap ' + cls, [el]);

// ---------- icons (built-in SVG, or a generated asset url) ----------
let uid = 0;
const INK = '#1b1430';
const ICON_SVG = {
  coin: (u) => `<defs><radialGradient id="g${u}" cx="38%" cy="30%" r="75%"><stop offset="0" stop-color="#fff6b0"/><stop offset=".45" stop-color="#ffd23f"/><stop offset="1" stop-color="#e08a00"/></radialGradient></defs>
    <circle cx="32" cy="34" r="25" fill="#b86400" stroke="${INK}" stroke-width="3.5"/><circle cx="32" cy="31" r="25" fill="url(#g${u})" stroke="${INK}" stroke-width="3.5"/>
    <circle cx="32" cy="31" r="17" fill="none" stroke="#d98200" stroke-width="3"/><path d="M32 19l3.6 7.6 8.3 1-6.1 5.7 1.6 8.2L32 37.4l-7.4 4.1 1.6-8.2-6.1-5.7 8.3-1z" fill="#ffe680" stroke="#c97a00" stroke-width="2" stroke-linejoin="round"/>
    <path d="M17 22c3-6 9-9 15-9" stroke="#fff" stroke-width="3.5" stroke-linecap="round" fill="none" opacity=".85"/>`,
  star: (u) => `<defs><linearGradient id="g${u}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff7b8"/><stop offset=".5" stop-color="#ffd23f"/><stop offset="1" stop-color="#ff9a1f"/></linearGradient></defs>
    <path d="M32 6l7.8 16 17.6 2.5-12.8 12.3 3.1 17.4L32 46l-15.7 8.2 3.1-17.4L6.6 24.5 24.2 22z" fill="url(#g${u})" stroke="${INK}" stroke-width="3.5" stroke-linejoin="round"/>
    <path d="M24 26l5-1.2 3-6.3" stroke="#fff" stroke-width="3" stroke-linecap="round" fill="none" opacity=".9"/><circle cx="27" cy="36" r="2.4" fill="${INK}"/><circle cx="37" cy="36" r="2.4" fill="${INK}"/>`,
  gem: (u) => `<defs><linearGradient id="g${u}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#c8fbff"/><stop offset=".5" stop-color="#3fd8ff"/><stop offset="1" stop-color="#1c6fe0"/></linearGradient></defs>
    <path d="M18 10h28l12 14-26 32L6 24z" fill="url(#g${u})" stroke="${INK}" stroke-width="3.5" stroke-linejoin="round"/>
    <path d="M6 24h52M18 10l8 14 6 32M46 10l-8 14-6 32M26 24l6-14 6 14" stroke="${INK}" stroke-width="2" fill="none" stroke-linejoin="round" opacity=".55"/><path d="M15 21l5-6" stroke="#fff" stroke-width="3" stroke-linecap="round"/>`,
  crystal: (u) => `<defs><linearGradient id="g${u}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#f1d6ff"/><stop offset=".5" stop-color="#b47cff"/><stop offset="1" stop-color="#6a2ccf"/></linearGradient></defs>
    <path d="M32 4l14 16-4 34-10 6-10-6-4-34z" fill="url(#g${u})" stroke="${INK}" stroke-width="3.5" stroke-linejoin="round"/><path d="M18 20h28M32 4v56" stroke="${INK}" stroke-width="2" opacity=".5"/><path d="M24 22l-1 18" stroke="#fff" stroke-width="3" stroke-linecap="round" opacity=".8"/>`,
  heart: (u) => `<defs><linearGradient id="g${u}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ff8fa8"/><stop offset=".55" stop-color="#ff3d5a"/><stop offset="1" stop-color="#c3123a"/></linearGradient></defs>
    <path d="M32 56S6 40 6 22c0-8 6-14 13.5-14 5.5 0 10 3.4 12.5 8 2.5-4.6 7-8 12.5-8C52 8 58 14 58 22c0 18-26 34-26 34z" fill="url(#g${u})" stroke="${INK}" stroke-width="3.5" stroke-linejoin="round"/>
    <path d="M14 20c1-4 4-6 7-6" stroke="#fff" stroke-width="3.5" stroke-linecap="round" fill="none"/>`,
  seed: (u) => `<defs><linearGradient id="g${u}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#d9a066"/><stop offset="1" stop-color="#8a5228"/></linearGradient><linearGradient id="l${u}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#c9f78a"/><stop offset="1" stop-color="#3fae4a"/></linearGradient></defs>
    <path d="M32 26c-4-10-14-14-22-12 2 9 10 15 22 12zM32 26c4-12 14-17 24-15-2 11-12 17-24 15z" fill="url(#l${u})" stroke="${INK}" stroke-width="3" stroke-linejoin="round"/>
    <ellipse cx="32" cy="42" rx="13" ry="16" fill="url(#g${u})" stroke="${INK}" stroke-width="3.5"/><path d="M26 34c1-3 3-5 5-6" stroke="#ffe0b8" stroke-width="3" stroke-linecap="round" fill="none"/>`,
  key: (u) => `<defs><linearGradient id="g${u}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff2a0"/><stop offset=".5" stop-color="#ffcf3a"/><stop offset="1" stop-color="#d98a00"/></linearGradient></defs>
    <path d="M28 30l24 0 0 8-5 0 0 6-6 0 0-6-13 0z" fill="url(#g${u})" stroke="${INK}" stroke-width="3.5" stroke-linejoin="round"/><circle cx="18" cy="34" r="12" fill="url(#g${u})" stroke="${INK}" stroke-width="3.5"/><circle cx="18" cy="34" r="4.5" fill="${INK}"/><path d="M11 29c1-3 3-4 5-5" stroke="#fff" stroke-width="3" stroke-linecap="round" fill="none"/>`,
  flag: (u) => `<defs><linearGradient id="g${u}" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#ff6b6b"/><stop offset="1" stop-color="#e0263f"/></linearGradient></defs>
    <path d="M14 6v52" stroke="${INK}" stroke-width="7" stroke-linecap="round"/><path d="M14 6v52" stroke="#e6edf5" stroke-width="3" stroke-linecap="round"/>
    <path d="M16 9c10-5 18 5 30 0l8 2-4 12 4 12c-12 5-22-5-38 0z" fill="url(#g${u})" stroke="${INK}" stroke-width="3.5" stroke-linejoin="round"/><path d="M22 15c6-2 10 0 14 1" stroke="#fff" stroke-width="3" stroke-linecap="round" fill="none" opacity=".8"/>`,
  checkered: (u) => `<path d="M14 6v52" stroke="${INK}" stroke-width="7" stroke-linecap="round"/><path d="M14 6v52" stroke="#e6edf5" stroke-width="3" stroke-linecap="round"/>
    <defs><pattern id="p${u}" width="12" height="12" patternUnits="userSpaceOnUse"><rect width="12" height="12" fill="#fff"/><rect width="6" height="6" fill="${INK}"/><rect x="6" y="6" width="6" height="6" fill="${INK}"/></pattern></defs>
    <path d="M16 9c10-5 18 5 30 0l8 2v24c-12 5-22-5-38 0z" fill="url(#p${u})" stroke="${INK}" stroke-width="3.5" stroke-linejoin="round"/>`,
  bolt: (u) => `<defs><linearGradient id="g${u}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fffbc2"/><stop offset=".5" stop-color="#ffe14d"/><stop offset="1" stop-color="#ff9a1f"/></linearGradient></defs>
    <path d="M38 4L12 36h16l-4 24 28-34H36z" fill="url(#g${u})" stroke="${INK}" stroke-width="3.5" stroke-linejoin="round"/><path d="M33 12l-10 14" stroke="#fff" stroke-width="3" stroke-linecap="round"/>`,
  skull: (u) => `<defs><linearGradient id="g${u}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffffff"/><stop offset="1" stop-color="#c9cbd8"/></linearGradient></defs>
    <path d="M32 6C18 6 9 15 9 28c0 8 4 13 9 16v10h28V44c5-3 9-8 9-16C55 15 46 6 32 6z" fill="url(#g${u})" stroke="${INK}" stroke-width="3.5" stroke-linejoin="round"/>
    <circle cx="23" cy="29" r="6.5" fill="${INK}"/><circle cx="41" cy="29" r="6.5" fill="${INK}"/><path d="M32 36l-4 6h8z" fill="${INK}"/><path d="M26 54v-6M32 54v-6M38 54v-6" stroke="${INK}" stroke-width="3"/>`,
  clock: (u) => `<defs><linearGradient id="g${u}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffffff"/><stop offset="1" stop-color="#d4e6f7"/></linearGradient></defs>
    <rect x="26" y="3" width="12" height="7" rx="2" fill="#ff6b6b" stroke="${INK}" stroke-width="3"/><circle cx="32" cy="36" r="23" fill="#ff6b6b" stroke="${INK}" stroke-width="3.5"/>
    <circle cx="32" cy="36" r="17" fill="url(#g${u})" stroke="${INK}" stroke-width="2.5"/><path d="M32 36V25M32 36l7 5" stroke="${INK}" stroke-width="3.5" stroke-linecap="round"/><circle cx="32" cy="36" r="2.5" fill="${INK}"/>`,
  trophy: (u) => `<defs><linearGradient id="g${u}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#fff2a0"/><stop offset=".5" stop-color="#ffcf3a"/><stop offset="1" stop-color="#d98a00"/></linearGradient></defs>
    <path d="M18 12h-9c0 12 5 18 13 19M46 12h9c0 12-5 18-13 19" stroke="${INK}" stroke-width="3.5" fill="none" stroke-linecap="round"/>
    <path d="M17 6h30v14c0 11-7 18-15 18S17 31 17 20z" fill="url(#g${u})" stroke="${INK}" stroke-width="3.5" stroke-linejoin="round"/>
    <path d="M28 38h8v8h-8z" fill="#d98a00" stroke="${INK}" stroke-width="3"/><rect x="18" y="46" width="28" height="10" rx="2" fill="#6b3fa0" stroke="${INK}" stroke-width="3.5"/><path d="M23 12v8c0 3 1 6 3 8" stroke="#fff" stroke-width="3" stroke-linecap="round" fill="none"/>`,
  leaf: (u) => `<defs><linearGradient id="g${u}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#d5f99a"/><stop offset="1" stop-color="#3a9e45"/></linearGradient></defs>
    <path d="M10 54C8 30 24 10 56 8c0 30-18 48-46 46z" fill="url(#g${u})" stroke="${INK}" stroke-width="3.5" stroke-linejoin="round"/><path d="M12 52C24 40 34 30 46 18" stroke="${INK}" stroke-width="2.5" stroke-linecap="round" opacity=".6"/>`,
  fruit: (u) => `<defs><radialGradient id="g${u}" cx="35%" cy="35%" r="70%"><stop offset="0" stop-color="#ffb3a0"/><stop offset=".5" stop-color="#ff4b4b"/><stop offset="1" stop-color="#b01530"/></radialGradient></defs>
    <path d="M32 18c-6-4-22-4-22 14 0 14 10 26 22 22 12 4 22-8 22-22 0-18-16-18-22-14z" fill="url(#g${u})" stroke="${INK}" stroke-width="3.5" stroke-linejoin="round"/>
    <path d="M32 18c0-6 2-10 6-12" stroke="${INK}" stroke-width="3.5" stroke-linecap="round" fill="none"/><path d="M36 12c6-4 12-2 14 2-6 3-10 2-14-2z" fill="#6cc46a" stroke="${INK}" stroke-width="2.5"/><path d="M17 28c1-4 3-6 6-7" stroke="#fff" stroke-width="3" stroke-linecap="round" fill="none"/>`,
  orb: (u) => `<defs><radialGradient id="g${u}" cx="35%" cy="32%" r="70%"><stop offset="0" stop-color="#ffffff"/><stop offset=".35" stop-color="#8ff3ff"/><stop offset="1" stop-color="#2a6fff"/></radialGradient></defs>
    <circle cx="32" cy="32" r="24" fill="url(#g${u})" stroke="${INK}" stroke-width="3.5"/><path d="M18 26c2-6 7-10 13-11" stroke="#fff" stroke-width="3.5" stroke-linecap="round" fill="none"/>`,
  shield: (u) => `<defs><linearGradient id="g${u}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#9fd8ff"/><stop offset="1" stop-color="#2d6fd6"/></linearGradient></defs>
    <path d="M32 4l22 8v16c0 14-10 26-22 32C20 54 10 42 10 28V12z" fill="url(#g${u})" stroke="${INK}" stroke-width="3.5" stroke-linejoin="round"/><path d="M32 12v40" stroke="#fff" stroke-width="3" opacity=".5"/>`,
  sword: (u) => `<path d="M46 6h12v12L30 46l-12-12z" fill="#e6edf5" stroke="${INK}" stroke-width="3.5" stroke-linejoin="round"/><path d="M12 36l16 16M20 48l-8 8M8 44l12 12" stroke="${INK}" stroke-width="5" stroke-linecap="round"/><path d="M14 38l12 12" stroke="#ffcf3a" stroke-width="3" stroke-linecap="round"/>`,
  person: (u) => `<circle cx="32" cy="20" r="11" fill="#ffd9b8" stroke="${INK}" stroke-width="3.5"/><path d="M12 58c0-14 9-22 20-22s20 8 20 22z" fill="#5aa0ff" stroke="${INK}" stroke-width="3.5" stroke-linejoin="round"/>`,
  // ---- power-ups (mechanics.js) ----
  speed: (u) => `<defs><linearGradient id="g${u}" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#7df9ff"/><stop offset="1" stop-color="#2a8cff"/></linearGradient></defs>
    <path d="M10 40l14-22h14l-6 10h16l6 12-6 10H22z" fill="url(#g${u})" stroke="${INK}" stroke-width="3.5" stroke-linejoin="round"/><path d="M4 26h10M2 36h8M6 46h8" stroke="${INK}" stroke-width="3.5" stroke-linecap="round"/><path d="M26 22h8" stroke="#fff" stroke-width="3" stroke-linecap="round"/>`,
  jump: (u) => `<defs><linearGradient id="g${u}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#b6ff7a"/><stop offset="1" stop-color="#3cc45a"/></linearGradient></defs>
    <path d="M32 4l16 18H38v12H26V22H16z" fill="url(#g${u})" stroke="${INK}" stroke-width="3.5" stroke-linejoin="round"/>
    <path d="M14 42l36 0M18 48l28 0M14 54l36 0" stroke="${INK}" stroke-width="4" stroke-linecap="round"/><path d="M14 42l36 0M14 54l36 0" stroke="#ffd23f" stroke-width="1.6" stroke-linecap="round"/>`,
  magnet: (u) => `<path d="M14 10v22a18 18 0 0 0 36 0V10H38v22a6 6 0 0 1-12 0V10z" fill="#ff4d5e" stroke="${INK}" stroke-width="3.5" stroke-linejoin="round"/>
    <path d="M14 10h12v8H14zM38 10h12v8H38z" fill="#e6edf5" stroke="${INK}" stroke-width="3" stroke-linejoin="round"/><path d="M19 30c0 6 3 11 8 13" stroke="#fff" stroke-width="3" stroke-linecap="round" fill="none" opacity=".8"/>`,
  giant: (u) => `<defs><linearGradient id="g${u}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ff8a5b"/><stop offset="1" stop-color="#e0263f"/></linearGradient></defs>
    <path d="M8 34C8 18 20 8 32 8s24 10 24 26z" fill="url(#g${u})" stroke="${INK}" stroke-width="3.5" stroke-linejoin="round"/><circle cx="22" cy="22" r="4.5" fill="#fff"/><circle cx="40" cy="18" r="3.5" fill="#fff"/><circle cx="44" cy="28" r="3" fill="#fff"/>
    <path d="M22 34h20v14a6 6 0 0 1-6 6h-8a6 6 0 0 1-6-6z" fill="#fff1d6" stroke="${INK}" stroke-width="3.5" stroke-linejoin="round"/><circle cx="28" cy="42" r="1.8" fill="${INK}"/><circle cx="36" cy="42" r="1.8" fill="${INK}"/>`,
  tiny: (u) => `<path d="M20 38C20 30 26 24 32 24s12 6 12 14z" fill="#8ff3ff" stroke="${INK}" stroke-width="3.5" stroke-linejoin="round"/><path d="M27 38h10v8a3 3 0 0 1-3 3h-4a3 3 0 0 1-3-3z" fill="#fff1d6" stroke="${INK}" stroke-width="3" stroke-linejoin="round"/>
    <path d="M10 10l8 8M54 10l-8 8M10 54l8-8M54 54l-8-8" stroke="${INK}" stroke-width="3.5" stroke-linecap="round"/><path d="M10 10h6M10 10v6M54 10h-6M54 10v6M10 54h6M10 54v-6M54 54h-6M54 54v-6" stroke="${INK}" stroke-width="3.5" stroke-linecap="round"/>`,
  invincible: (u) => `<defs><linearGradient id="g${u}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ff7ad9"/><stop offset=".35" stop-color="#ffe14d"/><stop offset=".7" stop-color="#5ef1ff"/><stop offset="1" stop-color="#9d7bff"/></linearGradient></defs>
    <path d="M32 5l8 16.4 18 2.6-13 12.7 3 18L32 46.2 16 54.7l3-18L6 24l18-2.6z" fill="url(#g${u})" stroke="${INK}" stroke-width="3.5" stroke-linejoin="round"/><path d="M24 25l5-1.2 3-6.5" stroke="#fff" stroke-width="3" stroke-linecap="round" fill="none"/>`,
  double_coins: (u) => `<defs><radialGradient id="g${u}" cx="38%" cy="30%" r="75%"><stop offset="0" stop-color="#fff6b0"/><stop offset=".5" stop-color="#ffd23f"/><stop offset="1" stop-color="#e08a00"/></radialGradient></defs>
    <circle cx="24" cy="30" r="16" fill="url(#g${u})" stroke="${INK}" stroke-width="3.5"/><circle cx="40" cy="34" r="16" fill="url(#g${u})" stroke="${INK}" stroke-width="3.5"/>
    <text x="40" y="41" text-anchor="middle" font-family="Arial Black,Arial" font-weight="900" font-size="18" fill="${INK}">x2</text>`,
  slowmo: (u) => `<path d="M16 6h32M16 58h32" stroke="${INK}" stroke-width="5" stroke-linecap="round"/><path d="M20 8c0 14 10 16 10 24S20 42 20 56h24c0-14-10-16-10-24S44 22 44 8z" fill="#c9f4ff" stroke="${INK}" stroke-width="3.5" stroke-linejoin="round"/>
    <path d="M26 52c2-6 6-8 6-12 0 4 4 6 6 12z" fill="#ffcf3a"/><path d="M26 16h12" stroke="#ffcf3a" stroke-width="4" stroke-linecap="round"/>`,
  ghost: (u) => `<path d="M14 56V28a18 18 0 0 1 36 0v28l-6-5-6 5-6-5-6 5-6-5z" fill="#eef2ff" stroke="${INK}" stroke-width="3.5" stroke-linejoin="round" opacity=".92"/><ellipse cx="25" cy="28" rx="3.5" ry="5" fill="${INK}"/><ellipse cx="39" cy="28" rx="3.5" ry="5" fill="${INK}"/><path d="M20 18c2-4 6-6 10-6" stroke="#fff" stroke-width="3" stroke-linecap="round" fill="none"/>`,
  // ---- interactables (mechanics.js) ----
  door: (u) => `<path d="M14 58V14a6 6 0 0 1 6-6h24a6 6 0 0 1 6 6v44z" fill="#b8763f" stroke="${INK}" stroke-width="3.5" stroke-linejoin="round"/><path d="M20 58V18h24v40" fill="#8a5228" stroke="${INK}" stroke-width="2.5"/><path d="M26 24v28M32 24v28M38 24v28" stroke="#6b3d1c" stroke-width="2"/>
    <circle cx="40" cy="38" r="3" fill="#ffd23f" stroke="${INK}" stroke-width="2"/><path d="M8 58h48" stroke="${INK}" stroke-width="4" stroke-linecap="round"/>`,
  switch: (u) => `<rect x="10" y="18" width="44" height="28" rx="14" fill="#3cff9e" stroke="${INK}" stroke-width="3.5"/><circle cx="40" cy="32" r="10" fill="#ffffff" stroke="${INK}" stroke-width="3.5"/><path d="M18 28v8" stroke="${INK}" stroke-width="3.5" stroke-linecap="round"/>`,
  lever: (u) => `<path d="M30 46L44 12" stroke="${INK}" stroke-width="7" stroke-linecap="round"/><path d="M30 46L44 12" stroke="#c9cbd8" stroke-width="3" stroke-linecap="round"/><circle cx="45" cy="11" r="6" fill="#ff4d5e" stroke="${INK}" stroke-width="3.5"/>
    <path d="M10 56c0-10 8-16 22-16s22 6 22 16z" fill="#6b6f80" stroke="${INK}" stroke-width="3.5" stroke-linejoin="round"/>`,
  button: (u) => `<ellipse cx="32" cy="44" rx="24" ry="10" fill="#6b6f80" stroke="${INK}" stroke-width="3.5"/><path d="M14 40v-8c0-5 8-9 18-9s18 4 18 9v8c0 5-8 9-18 9s-18-4-18-9z" fill="#ff4d5e" stroke="${INK}" stroke-width="3.5"/><ellipse cx="32" cy="32" rx="18" ry="8" fill="#ff8a95" stroke="${INK}" stroke-width="3"/>`,
  chest: (u) => `<path d="M8 30h48v24H8z" fill="#b8763f" stroke="${INK}" stroke-width="3.5" stroke-linejoin="round"/><path d="M8 30c0-12 10-18 24-18s24 6 24 18z" fill="#d18a4a" stroke="${INK}" stroke-width="3.5" stroke-linejoin="round"/>
    <path d="M8 30h48M20 13v41M44 13v41" stroke="#ffcf3a" stroke-width="3.5"/><rect x="27" y="27" width="10" height="11" rx="2" fill="#ffcf3a" stroke="${INK}" stroke-width="2.5"/>`,
  teleporter: (u) => `<defs><radialGradient id="g${u}" cx="50%" cy="50%" r="50%"><stop offset="0" stop-color="#ffffff"/><stop offset=".45" stop-color="#b47cff"/><stop offset="1" stop-color="#2a1a6a"/></radialGradient></defs>
    <ellipse cx="32" cy="32" rx="18" ry="26" fill="url(#g${u})" stroke="${INK}" stroke-width="3.5"/><path d="M32 14c-6 6-6 30 0 36M26 22c4 6 8 14 0 20" stroke="#fff" stroke-width="2.5" fill="none" opacity=".8"/>`,
  spring: (u) => `<path d="M14 52h36M18 44l28-6M18 36l28-6M18 28l28-6" stroke="${INK}" stroke-width="6" stroke-linecap="round"/><path d="M18 44l28-6M18 36l28-6M18 28l28-6" stroke="#c9cbd8" stroke-width="2.5" stroke-linecap="round"/>
    <rect x="12" y="10" width="40" height="10" rx="3" fill="#ff4d5e" stroke="${INK}" stroke-width="3.5"/><rect x="10" y="50" width="44" height="8" rx="3" fill="#6b6f80" stroke="${INK}" stroke-width="3"/>`,
  crate: (u) => `<rect x="10" y="10" width="44" height="44" rx="3" fill="#d18a4a" stroke="${INK}" stroke-width="3.5"/><path d="M10 10l44 44M54 10L10 54" stroke="#8a5228" stroke-width="4"/><rect x="10" y="10" width="44" height="44" rx="3" fill="none" stroke="${INK}" stroke-width="3.5"/>`,
  rule: (u) => `<path d="M32 6l26 46H6z" fill="#ffcf3a" stroke="${INK}" stroke-width="3.5" stroke-linejoin="round"/><path d="M32 22v14" stroke="${INK}" stroke-width="5" stroke-linecap="round"/><circle cx="32" cy="44" r="3" fill="${INK}"/>`,
  gear: (u) => `<path d="M28 4h8l2 8 6 3 7-5 6 6-5 7 3 6 8 2v8l-8 2-3 6 5 7-6 6-7-5-6 3-2 8h-8l-2-8-6-3-7 5-6-6 5-7-3-6-8-2v-8l8-2 3-6-5-7 6-6 7 5 6-3z" fill="#b47cff" stroke="${INK}" stroke-width="3" stroke-linejoin="round"/><circle cx="32" cy="32" r="8" fill="#fff" stroke="${INK}" stroke-width="3"/>`,
};
const ICON_ALIAS = { coins: 'coin', gold: 'coin', stars: 'star', gems: 'gem', diamond: 'gem', hearts: 'heart', life: 'heart', lives: 'heart', seeds: 'seed', keys: 'key',
  invincibility: 'invincible', star_power: 'invincible', starman: 'invincible', double: 'double_coins', coin_x2: 'double_coins', slow: 'slowmo',
  slow_motion: 'slowmo', big: 'giant', grow: 'giant', mega: 'giant', shrink: 'tiny', mini: 'tiny', small: 'tiny', high_jump: 'jump', super_jump: 'jump',
  jump_boost: 'jump', speed_boost: 'speed', haste: 'speed', fast: 'speed', portal: 'teleporter', teleport: 'teleporter', pressure_plate: 'button',
  plate: 'button', trampoline: 'spring', bounce: 'spring', bounce_pad: 'spring', box: 'crate', gate: 'door', treasure: 'chest', custom: 'gear',
  mechanic: 'gear', hazard: 'rule', warning: 'rule', invisible: 'ghost', phase: 'ghost',
  flags: 'flag', goal: 'checkered', finish: 'checkered', energy: 'bolt', boost: 'bolt', enemy: 'skull', enemies: 'skull', kills: 'skull', time: 'clock', timer: 'clock',
  cup: 'trophy', score: 'trophy', crystals: 'crystal', apple: 'fruit', fruits: 'fruit', leaves: 'leaf', orbs: 'orb', flower: 'fruit', flowers: 'fruit', rings: 'coin' };
export const ICONS = Object.keys(ICON_SVG);   // built-in icon names (CONTRACT choice list)
export const icons = ICONS;
// manifest entry of a kind tagged for a name ({"kind":"icon","for":"coin"} / {"kind":"sfx","event":"collect"})
function manifestFor(game, kind, name, field = 'for') {
  const m = game && game.assets && game.assets.manifest;
  if (!m) return null;
  for (const k in m) if (m[k] && m[k].kind === kind && (m[k][field] === name || m[k][field] === name.replace(/s$/, ''))) return game.asset(k);
  return null;
}
export function icon(game, name, cls = 'tk-ico') {
  const n = String(name || 'star');
  let url = null;
  if (/[/.]/.test(n)) url = n;
  else if (game && game.asset) url = game.asset('icon_' + n) || game.asset(n + '_icon') || manifestFor(game, 'icon', n)
    || (game.assets && game.assets.manifest && game.assets.manifest[n] && game.assets.manifest[n].kind === 'icon' ? game.asset(n) : null) || null;
  if (url) {
    const img = h('img', cls, null, { src: url, alt: n, draggable: 'false' }); img.style.objectFit = 'contain';
    img.onerror = () => { const fb = icon(null, n, cls); img.replaceWith(fb); };   // missing generated file -> built-in SVG
    return img;
  }
  const key = ICON_SVG[n] ? n : ICON_ALIAS[n.toLowerCase()] || (ICON_SVG[n.toLowerCase().replace(/s$/, '')] ? n.toLowerCase().replace(/s$/, '') : 'star');
  const wrapEl = h('span', cls);
  wrapEl.innerHTML = `<svg viewBox="0 0 64 64" width="100%" height="100%">${ICON_SVG[key](++uid)}</svg>`;
  wrapEl.style.display = 'inline-block';
  return wrapEl;
}

// ---------- root + theme ----------
let cssPromise = null;
function loadCss() {
  if (!cssPromise) {
    const l = document.createElement('link');
    l.rel = 'stylesheet'; l.href = new URL('./ui/ui.css', import.meta.url).href;
    cssPromise = new Promise((res) => { l.onload = res; l.onerror = () => { reportError(new Error('UI: could not load kit/ui/ui.css')); res(); }; });
    document.head.appendChild(l);
    // warm the fonts so the first banner doesn't flash in a fallback face
    if (document.fonts) cssPromise.then(() => Promise.all(['TK Lilita', 'TK Rubik', 'TK Fredoka', 'TK Cinzel', 'TK Orbitron'].map(f => document.fonts.load(`700 20px "${f}"`).catch(() => {}))));
  }
  return cssPromise;
}
function hexOf(c) {
  if (c == null) return null;
  try { return '#' + (c.isColor ? c : new THREE.Color(c)).getHexString(); } catch { return null; }
}
function lum(hex) { const c = new THREE.Color(hex); return 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b; }

function ui(game, opts = {}) {
  if (!game || !game.on) throw new Error('UI: first argument must be the game from createGame()');
  if (game.__ui) { if (opts.style) setStyle(game, opts.style); return game.__ui; }
  loadCss();
  const root = h('div', 'tk-ui');
  document.body.appendChild(root);
  const U = game.__ui = { root, style: null, hud: null, screen: null, banners: [], bannerBusy: false, toasts: null, ended: false, title: null, pauseEl: null, keyHandlers: [] };
  setStyle(game, opts.style || guessStyle(game));
  // one keyboard listener for all UI layers (title, menus, dialogs); topmost handler wins
  window.addEventListener('keydown', (e) => {
    const top = U.keyHandlers[U.keyHandlers.length - 1];
    if (top && top(e) !== false) return;
    if ((e.code === 'Escape' || e.code === 'KeyP') && U.hud && U.hud.autoPause && !U.title && !U.ended && !U.dialog) { e.preventDefault(); togglePause(game); }
  });
  return U;
}
function guessStyle(game) {
  try {
    const name = game.look && (game.look.name || game.look);
    if (typeof name === 'string' && LOOK_STYLE[name]) return LOOK_STYLE[name];
  } catch {}
  return 'arcade';
}
export function setStyle(game, style = 'arcade') {
  const U = game.__ui || ui(game, { style });
  if (!STYLES.includes(style)) throw new Error(`UI: unknown style "${style}"; styles: ${STYLES.join(', ')}`);
  for (const s of STYLES) U.root.classList.remove('tk-' + s);
  U.root.classList.add('tk-' + style);
  U.style = style;
  // palette accents from Look (only once a look is applied): highlight colour for display text + panel tint
  try {
    const p = game.look && typeof Look.palette === 'function' ? Look.palette(game) : null;
    for (const k of ['--tk-p', '--tk-p2', '--tk-panel-a', '--tk-panel-b', '--tk-ink', '--tk-dim']) U.root.style.removeProperty(k);
    if (p && typeof p === 'object' && style !== 'sleek' && style !== 'scifi') {
      const hi = hexOf(p.uiAccent || p.accent);
      if (hi && lum(hi) > 0.3) { U.root.style.setProperty('--tk-p', hi); U.root.style.setProperty('--tk-p2', hexOf(new THREE.Color(hi).offsetHSL(-0.05, 0.08, -0.2))); }
      // arcade plates take the look's primary hue (deep and saturated so white numbers stay legible); ink follows
      const prim = hexOf(p.primary);
      if (prim && style === 'arcade') {
        const hsl = new THREE.Color(prim).getHSL({});
        const sat = Math.min(0.68, Math.max(0.35, hsl.s));
        const C = (l, s2 = sat) => '#' + new THREE.Color().setHSL(hsl.h, s2, l).getHexString();
        U.root.style.setProperty('--tk-panel-a', C(0.32));
        U.root.style.setProperty('--tk-panel-b', C(0.19));
        U.root.style.setProperty('--tk-ink', C(0.075, 0.55));
        U.root.style.setProperty('--tk-dim', C(0.8, 0.45));
      } else {
        const panelC = hexOf(p.ui);
        if (panelC && lum(panelC) < 0.2 && style === 'fantasy') {
          U.root.style.setProperty('--tk-panel-a', hexOf(new THREE.Color(panelC).offsetHSL(0, 0.05, 0.08)));
          U.root.style.setProperty('--tk-panel-b', hexOf(new THREE.Color(panelC).offsetHSL(0, 0, -0.1)));
        }
      }
    }
  } catch (e) { reportError(e); }
  return style;
}
export function uiRoot(game) { return ui(game).root; }
export function show(game, on = true) { const U = ui(game); U.root.classList.toggle('tk-hidden', !on); return on; }
function setPhase(game, ph) { const st = game.state || (game.state = {}); if (st.phase !== 'won' && st.phase !== 'lost' && !st.won && !st.lost) st.phase = ph; }
const emitUi = (game, type, extra) => { try { game.emit('ui', { type, ...extra }); } catch {} };

// ---------- state readers (feature-detect what gameplay.js writes) ----------
const num = (v) => (typeof v === 'number' && Number.isFinite(v)) ? v : (Array.isArray(v) ? v.length : (v && typeof v === 'object' && typeof v.count === 'number') ? v.count : null);
function readCounter(game, c) {
  const st = game.state || {};
  let v = typeof c.value === 'function' ? c.value(st) : num(st[c.id]);
  if (v == null && st.collected && typeof st.collected === 'object') v = num(st.collected[c.id]) ?? num(st.collected[c.tag]);
  if (v == null && st.counts) v = num(st.counts[c.id]);
  // Gameplay.rules publishes the main pickup as state.collected / state.target (tag in state.collectTag)
  const tag = st.collectTag, main = c.id === 'collected' || (tag && (c.id === tag || c.id === tag + 's' || c.tag === tag)) || c.useGlobalTarget;
  if (v == null && main) v = num(st.collected);
  let t = c.target ?? num(st[c.id + 'Target']) ?? num(st[c.id + 'Total']) ?? (st.targets ? num(st.targets[c.id]) : null);
  if (t == null && main) t = num(st.target) || null;
  // races: pickups are a side score, not the goal; only an explicit counter target is shown there
  if (c.target == null && num(st.laps) > 0) t = null;
  return { v: v ?? 0, t };
}
function readTimer(game, H) {
  const st = game.state || {};
  if (typeof H.opts.timer === 'function') return { t: H.opts.timer(st), down: false };
  if (num(st.timeLeft) != null) return { t: st.timeLeft, down: true };
  if (num(st.timer) != null) return { t: st.timer, down: !!st.timerDown };
  if (num(st.time) != null) return { t: st.time, down: false };
  if (num(st.elapsed) != null) return { t: st.elapsed, down: false };
  return { t: H.ownTime, down: false };
}
function fmtTime(s, tenths = true) {
  s = Math.max(0, s || 0);
  const m = Math.floor(s / 60), sec = Math.floor(s % 60), t = Math.floor((s * 10) % 10);
  return { main: `${m}:${String(sec).padStart(2, '0')}`, frac: tenths ? `.${t}` : '' };
}
const ordinal = (n) => { const s = ['th', 'st', 'nd', 'rd'], v = n % 100; return s[(v - 20) % 10] || s[v] || s[0]; };
function playerOf(game, H) { return (H && H.opts.player) || (window.__kit && window.__kit.game === game && window.__kit.player) || game.__player || game.player || null; }
function levelOf(game, H) { return (H && (H.opts.level || (H.opts.minimap && H.opts.minimap.level))) || (window.__kit && window.__kit.game === game && window.__kit.level) || game.__level || game.level || null; }

// ---------- HUD ----------
export function hud(game, opts = {}) {
  const U = ui(game, opts);
  if (U.hud) U.hud.remove();
  const el = h('div', 'tk-hud tk-hud-in');
  const C = { tl: h('div', 'tk-corner tk-tl'), tc: h('div', 'tk-corner tk-tc'), tr: h('div', 'tk-corner tk-tr'), bl: h('div', 'tk-corner tk-bl'), br: h('div', 'tk-corner tk-br') };
  Object.values(C).forEach(c => el.append(c));
  const vign = h('div', 'tk-vignette'); el.prepend(vign);
  U.root.prepend(el);
  if (U.title) el.style.visibility = 'hidden';   // title screen is up: HUD slides in when it closes
  try { Touch.install(game, { player: opts.player }); } catch (e) { reportError(e); }
  try { Assist.install(game, { player: opts.player, level: opts.level || (opts.minimap && opts.minimap.level) }); } catch (e) { reportError(e); }
  const H = U.hud = { el, opts, C, counters: [], ownTime: 0, running: false, autoPause: opts.pauseMenu !== false, offs: [], vign, last: {} };

  if (opts.title && opts.showTitle) C.tl.append(h('div', 'tk-gametitle tk-ol', [opts.title]));

  // counters (top-left)
  const counters = (opts.counters || []).map(c => typeof c === 'string' ? { id: c } : c);
  counters.forEach((c, i) => {
    if (!c || !c.id) throw new Error('UI.hud: every counter needs an id, e.g. counters: [{ id: "coins", icon: "coin", label: "Coins", target: 30 }]');
    const val = h('span', 'tk-val', ['0']), of = h('span', 'tk-of', ['']);
    const ico = icon(game, c.icon || c.id);
    const lbl = c.label && (c.showLabel || (counters.length > 1 && c.showLabel !== false)) ? h('span', 'tk-lbl tk-ol', [c.label]) : null;
    const box = h('div', 'tk-counter', [ico, lbl, wrap(panel([val, of]))]);
    C.tl.append(box);
    const bonus = h('span', 'tk-bonus tk-ol', ['']);
    box.append(bonus);
    H.counters.push({ c: { ...c, useGlobalTarget: counters.length === 1 }, box, val, of, bonus, last: null, lastT: undefined });
  });

  // timer + objective (top-centre)
  if (opts.timer) {
    const val = h('span', 'tk-val', ['0:00']);
    H.timer = { box: h('div', 'tk-timer', [wrap(panel([icon(game, 'clock'), val]))]), val, last: '' };
    C.tc.append(H.timer.box);
  }
  if (opts.objective || opts.objective === '') {
    const txt = h('span', '', [opts.objective]);
    H.objective = { box: h('div', 'tk-objective', [wrap(panel([icon(game, opts.objectiveIcon || 'flag'), txt]))]), txt };
    C.tc.append(H.objective.box);
  }

  // lives, lap, place (top-right)
  if (opts.lives || opts.hp || opts.health) {
    if (!opts.lives) opts.lives = 'health';
    const box = h('div', 'tk-lives');
    H.lives = { box, hearts: [], max: typeof opts.lives === 'number' ? opts.lives : null, last: null, icon: opts.livesIcon || 'heart', key: (opts.lives === 'hp' || opts.lives === 'health') ? 'health' : 'lives' };
    C.tr.append(box);
  }
  if (opts.lap) {
    const v = h('span', 'tk-v', ['1']), of = h('span', 'tk-of', ['']);
    H.lap = { box: h('div', 'tk-lap', [wrap(panel([h('span', 'tk-k', ['Lap']), v, of]))]), v, of, total: typeof opts.lap === 'number' ? opts.lap : null, last: null };
    C.tr.append(H.lap.box);
  }
  if (opts.position) {
    const box = h('div', 'tk-pos');
    H.pos = { box, last: null };
    C.tr.append(box);
  }

  // minimap (bottom-left), speedometer (bottom-right)
  if (opts.minimap) H.minimap = minimap(game, H, C.bl, opts.minimap === true ? {} : opts.minimap);
  if (opts.speedometer) H.speedo = speedometer(game, H, C.br, opts.speedometer === true ? {} : opts.speedometer);

  // own clock for games that don't publish one: runs from 'start' to win/lose, frozen while paused
  const tick = game.lateUpdate((dt) => {
    if (H.running && !U.ended && !game.paused && !U.title) H.ownTime += dt;
    refresh(game, H);
  }, 31);
  H.running = !!game.started;
  const on = (ev, fn) => H.offs.push(game.on(ev, (...a) => { try { fn(...a); } catch (e) { reportError(e); } }));
  on('start', () => { H.running = true; });
  if (opts.auto !== false) autoEvents(game, H, on);
  setTimeout(() => el.classList.remove('tk-hud-in'), 1500);

  H.set = (id, value) => { game.state[id] = value; };
  H.setObjective = (text) => objective(game, text);
  H.remove = () => { game.removeUpdate(tick); H.offs.forEach(f => f && f()); el.remove(); if (U.hud === H) U.hud = null; };
  return H;
}

// "Collect 20 orbs" -> "Collect 20 fish" when the HUD counter for the main pickup has its own label
function nounFix(H, st, text) {
  const tag = st.collectTag, c = H.counters.find(k => k.c.useGlobalTarget || k.c.id === 'collected' || k.c.id === tag);
  if (!tag || !c || !c.c.label) return text;
  const lbl = c.c.label.toLowerCase();
  return text.replace(new RegExp('\\b' + tag.replace(/[^a-z0-9_]/gi, '') + 's?\\b', 'gi'), lbl);
}
function refresh(game, H) {
  const st = game.state || {};
  for (const k of H.counters) {
    const { v, t } = readCounter(game, k.c);
    // never "21/10": a met target reads "10/10" with a check, extras go in a "+11" bonus tag
    const over = t != null && v > t ? Math.round(v - t) : 0;
    if (v !== k.last || t !== k.lastT) { k.val.textContent = Math.round(t != null && v > t ? t : v).toLocaleString(); k.bonus.textContent = over ? `+${over}` : ''; }
    if (v !== k.last) {
      if (k.last != null && v > k.last) {
        k.box.classList.remove('tk-pop'); void k.box.offsetWidth; k.box.classList.add('tk-pop');
        const g = h('span', 'tk-ghost tk-ol', [`+${Math.round(v - k.last)}`]); k.box.append(g); setTimeout(() => g.remove(), 850);
      }
      k.last = v;
    }
    if (t !== k.lastT) { k.of.textContent = t != null ? `/${t}` : ''; k.lastT = t; }
    k.box.classList.toggle('tk-done', t != null && v >= t);
  }
  if (H.timer) {
    const { t, down } = readTimer(game, H);
    const f = fmtTime(t, !(down && t > 60));
    const s = f.main + f.frac;
    if (s !== H.timer.last) { H.timer.val.innerHTML = `${f.main}<small>${f.frac}</small>`; H.timer.last = s; }
    H.timer.box.classList.toggle('tk-urgent', down && t <= 10 && t > 0);
  }
  // the game's own objective line wins over the rules' generic one (unless it was cut off mid-word by the plan's length cap)
  const own = typeof H.opts.objective === 'string' ? H.opts.objective.trim() : '';
  const ownOk = own && !(own.length >= 58 && !/[.!?)…]$/.test(own));
  const progress = typeof st.objective === 'string' && /\(\d+\s*\/\s*\d+\)|^you (win|lose)/i.test(st.objective);   // quest steps "(1/4)", end lines
  if ((!ownOk || progress) && typeof st.objective === 'string' && st.objective && H.opts.objective !== false) {
    const txt = nounFix(H, st, st.objective);
    if (!H.objective || txt !== H.objective.txt.textContent) objective(game, txt);
  }
  if (H.lives) {
    // hearts show health whenever the rules track it (hits are visible), with the remaining lives as a "x2" tag;
    // without health they show lives
    const L = H.lives;
    const hpMax = num(st.maxHealth) ?? num(st.maxHp), hp = num(st.health) ?? num(st.hp), lives = num(st.lives);
    const useHp = L.key === 'health' || (hpMax != null && hpMax > 1 && hp != null);
    const v = useHp ? hp : lives;
    const showLives = useHp && L.key !== 'health' && lives != null;
    const sig = `${useHp}|${v}|${showLives ? lives : ''}`;
    if (v != null && sig !== L.sig) {
      if (L.mode !== useHp) { L.mode = useHp; L.max = useHp ? null : (typeof H.opts.lives === 'number' ? H.opts.lives : null); L.hearts = []; L.big = false; L.last = null; L.lx = null; L.box.innerHTML = ''; }
      const max = useHp ? (hpMax ?? L.max ?? v) : (num(st.maxLives) ?? L.max ?? Math.max(v, L.hearts.length || v));
      L.max = Math.max(max, L.max || 0);
      if (L.max > 6) {
        if (!L.big) { L.box.innerHTML = ''; L.ico = icon(game, L.icon, 'tk-heart'); L.x = h('span', 'tk-lives-x', ['']); L.box.append(wrap(panel([L.ico, L.x]))); L.big = true; L.lx = null; }
        L.x.textContent = `×${v}`;
        if (L.last != null && v < L.last) { L.ico.classList.remove('tk-lost'); void L.ico.offsetWidth; L.ico.classList.add('tk-lost'); }
      } else {
        if (L.hearts.length !== L.max) { L.box.innerHTML = ''; L.hearts = []; L.lx = null; const p = panel([]); for (let i = 0; i < L.max; i++) { const hh = icon(game, L.icon, 'tk-heart'); L.hearts.push(hh); p.append(hh); } L.box.append(wrap(p)); }
        L.hearts.forEach((hh, i) => {
          const empty = i >= v;
          if (empty && !hh.classList.contains('tk-empty') && L.last != null) { hh.classList.add('tk-lost'); setTimeout(() => hh.classList.remove('tk-lost'), 600); }
          hh.classList.toggle('tk-empty', empty);
        });
      }
      if (showLives) {
        if (!L.lx) { L.lx = h('span', 'tk-lives-x tk-lives-n', ['']); const p = L.box.querySelector('.tk-panel'); if (p) p.append(L.lx); }
        if (L.lx.textContent && L.lx.textContent !== `×${lives}`) { L.lx.classList.remove('tk-lost'); void L.lx.offsetWidth; L.lx.classList.add('tk-lost'); }
        L.lx.textContent = `×${lives}`;
      }
      L.last = v; L.sig = sig;
    }
  }
  if (H.lap) {
    const lap = num(st.lap), total = num(st.laps) ?? num(st.lapCount) ?? H.lap.total;
    const key = `${lap}/${total}`;
    if (key !== H.lap.last) { H.lap.v.textContent = String(Math.max(1, lap ?? 1)); H.lap.of.textContent = total ? `/${total}` : ''; H.lap.last = key; }
  }
  if (H.pos) {
    const p = num(st.position) ?? num(st.place) ?? num(st.rank);
    const n = num(st.racers) ?? num(st.racerCount);
    if (p != null && p > 0 && p !== H.pos.last) {
      H.pos.box.className = 'tk-pos tk-pop ' + (p <= 3 ? 'tk-p' + p : 'tk-pn');
      H.pos.box.innerHTML = '';
      H.pos.box.append(bigText(String(p)), bigText(ordinal(p), 'tk-suf'));
      if (n) H.pos.box.append(h('span', 'tk-of tk-ol', [`/${n}`]));
      H.pos.last = p;
    }
  }
  // mechanics state, when mechanics.js keeps it there: game.state.keys = ['red', ...], game.state.powerups = {type: secondsLeft}
  if (Array.isArray(st.keys)) { const k = st.keys.join(','); if (k !== H.last.keys) { H.last.keys = k; keyring(game, st.keys); } }
  if (st.powerups && typeof st.powerups === 'object') {
    const M = mechTray(game);
    for (const [type, left] of Object.entries(st.powerups)) {
      if (!(left > 0)) continue;
      const c = M.chips.get(type);
      if (!c) powerup(game, { type, duration: left });
      else if (Math.abs(c.left - left) > 0.5) { if (left > c.left) c.dur = Math.max(c.dur, left); c.left = left; }
    }
    for (const type of [...M.chips.keys()]) if (!(st.powerups[type] > 0) && M.chips.get(type).fromState !== false && H.last.puSeen && H.last.puSeen.has(type)) powerupEnd(game, type);
    H.last.puSeen = new Set(Object.keys(st.powerups).filter(t => st.powerups[t] > 0));
  }
  if (H.minimap) H.minimap.draw();
  if (H.speedo) H.speedo.update();
}

export function objective(game, text) {
  const U = ui(game), H = U.hud;
  if (!H) throw new Error('UI.objective: call UI.hud(game, {...}) first');
  if (!H.objective) {
    const txt = h('span', '', ['']);
    H.objective = { box: h('div', 'tk-objective', [wrap(panel([icon(game, 'flag'), txt]))]), txt };
    H.C.tc.append(H.objective.box);
  }
  H.objective.txt.textContent = String(text);
  H.objective.box.classList.remove('tk-flash'); void H.objective.box.offsetWidth; H.objective.box.classList.add('tk-flash');
}

function autoEvents(game, H, on) {
  const U = game.__ui, o = H.opts;
  let lastCp = 0;
  on('checkpoint', () => { const n = performance.now(); if (n - lastCp > 1500 && !U.ended) { lastCp = n; banner(game, o.checkpointText || 'Checkpoint!', { style: 'checkpoint', duration: 1.1 }); } });
  on('lap', (pl, n) => {
    const total = num((game.state || {}).laps) ?? H.lap?.total;
    if (!(n > 1) || U.ended) return;
    if (total && n > total) return;
    banner(game, total && n === total ? 'Final Lap!' : `Lap ${n}${total ? '/' + total : ''}`, { style: total && n === total ? 'warning' : 'checkpoint', duration: 1.4 });
  });
  on('damage', (target) => {
    const pl = playerOf(game, H);
    if (pl && target !== pl && target !== pl.object) return;
    if (H.lives) { H.lives.box.classList.remove('tk-shake'); void H.lives.box.offsetWidth; H.lives.box.classList.add('tk-shake'); }
    H.vign.classList.add('tk-on'); clearTimeout(H.vignT); H.vignT = setTimeout(() => H.vign.classList.remove('tk-on'), 900);
  });
  on('win', () => { if (U.ended) return; U.ended = true; H.running = false; if (o.winScreen !== false) setTimeout(() => winScreen(game, typeof o.winScreen === 'object' ? o.winScreen : {}), o.winDelay ?? 1100); });
  on('lose', (reason) => { if (U.ended) return; U.ended = true; H.running = false; if (o.loseScreen !== false) setTimeout(() => loseScreen(game, { reason, ...(typeof o.loseScreen === 'object' ? o.loseScreen : {}) }), o.loseDelay ?? 900); });
  // mechanics.js events (feature-detected there; argument shapes are forgiving: the info object may come first or second)
  const info = (a, b) => (b && typeof b === 'object' && !b.isObject3D && !b.position ? b : a && typeof a === 'object' && !a.isObject3D && !a.position ? a : {}) || {};
  const label = (x) => String(x || '').replace(/_/g, ' ');
  on('powerup', (a, b) => { const o = info(a, b); powerup(game, { type: o.type || o.name, duration: o.duration ?? o.seconds, icon: o.icon, label: o.label }); });
  on('powerupEnd', (a, b) => { const o = info(a, b); powerupEnd(game, o.type || o.name || (typeof a === 'string' ? a : '')); });
  on('key', (a, b) => { const o = info(a, b); keyring(game).add(o.color || o.key || (typeof b === 'string' ? b : 'gold')); });
  on('keyUsed', (a, b) => { const o = info(a, b); keyring(game).remove(o.color || o.key || (typeof b === 'string' ? b : 'gold')); });
  on('door', (a, b) => {
    const o = info(a, b);
    if (o.locked || o.open === false) toast(game, o.text || `Locked: needs the ${label(o.color || o.needs || '')} key`.replace('the  key', 'a key'), { icon: 'door', duration: 1.8 });
    else if (o.open) toast(game, o.text || 'Door opened', { icon: 'door', duration: 1.4 });
  });
  on('switch', (a, b) => { const o = info(a, b); if (o.text || o.label) toast(game, o.text || o.label, { icon: o.kind || 'switch', duration: 1.6 }); });
  on('rule', (a, b) => { const o = typeof a === 'string' ? { text: a } : info(a, b); if (o.silent) return; ruleToast(game, o.text || label(o.name) || 'Rule!', { seconds: o.seconds ?? o.duration, icon: o.icon }); });
  on('mechanic', (a, b) => { const o = typeof a === 'string' ? { name: a } : info(a, b); mechanicBanner(game, o.title || label(o.name), { text: o.text }); });
  on('prompt', (a, b) => { if (a == null || a === false) return prompt(game, null); const o = typeof a === 'string' ? { text: a, key: b } : info(a, b); prompt(game, o.text, { key: o.key, icon: o.icon }); });
  on('pause', (b) => { if (game.__kitPause) return; if (b && !U.pauseEl && !U.ended && !U.title && !U.dialog && !U.counting) pauseMenu(game); else if (!b && U.pauseEl) closePause(game, false); });
}

// ---------- minimap ----------
function minimap(game, H, parent, mo = {}) {
  const cv = h('canvas');
  const box = h('div', 'tk-minimap', [cv]);
  parent.append(box);
  const ctx = cv.getContext('2d');
  let bounds = null, lastDraw = 0, route = null;
  const M = { box };
  const getBounds = (level) => {
    // frame what the player travels (route, pickups, checkpoints), not the whole ocean
    try { const lv = { ...level, bounds: null, group: null }; const b = frameBox(game, lv, null); return b; } catch { return null; }
  };
  let inkC = null, accC = null, styleSeen = null;
  const ink = () => inkC;
  M.draw = () => {
    const now = performance.now();
    if (now - lastDraw < 50) return;
    lastDraw = now;
    const level = (mo.level) || levelOf(game, H);
    if (!level) return;
    if (!bounds || M.level !== level) { bounds = getBounds(level); M.level = level; route = null; }
    if (styleSeen !== game.__ui.style) { const cs = getComputedStyle(H.el); inkC = cs.getPropertyValue('--tk-ink').trim() || '#0b1020'; accC = cs.getPropertyValue('--tk-p').trim() || '#ffd23c'; styleSeen = game.__ui.style; }
    if (!bounds) return;
    const dpr = Math.min(2, devicePixelRatio || 1), W = Math.round(box.clientWidth * dpr), Hh = Math.round(box.clientHeight * dpr);
    if (!W || !Hh) return;
    if (cv.width !== W || cv.height !== Hh) { cv.width = W; cv.height = Hh; }
    const sx = bounds.max.x - bounds.min.x, sz = bounds.max.z - bounds.min.z, cx = (bounds.max.x + bounds.min.x) / 2, cz = (bounds.max.z + bounds.min.z) / 2;
    const k = (Math.min(W, Hh) * 0.8) / Math.max(sx, sz, 1);
    const P = (p) => [W / 2 + (p.x - cx) * k, Hh / 2 + (p.z - cz) * k];
    ctx.clearRect(0, 0, W, Hh);
    // grid
    ctx.globalAlpha = 0.12; ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 1 * dpr;
    for (let i = 1; i < 6; i++) { ctx.beginPath(); ctx.moveTo((W / 6) * i, 0); ctx.lineTo((W / 6) * i, Hh); ctx.stroke(); ctx.beginPath(); ctx.moveTo(0, (Hh / 6) * i); ctx.lineTo(W, (Hh / 6) * i); ctx.stroke(); }
    ctx.globalAlpha = 1;
    // route / track
    if (!route) {
      route = [];
      if (level.track && level.track.getPoints) route = level.track.getPoints(160);
      else if (Array.isArray(level.route)) route = level.route.map(p => p.isVector3 ? p : new THREE.Vector3(p.x ?? p[0], p.y ?? p[1], p.z ?? p[2]));
      M.closed = !!level.track;
    }
    if (route.length > 1) {
      const path = () => { ctx.beginPath(); route.forEach((p, i) => { const [x, y] = P(p); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); }); if (M.closed) ctx.closePath(); };
      ctx.lineJoin = 'round'; ctx.lineCap = 'round';
      path(); ctx.strokeStyle = ink(); ctx.lineWidth = 7 * dpr; ctx.stroke();
      path(); ctx.strokeStyle = 'rgba(255,255,255,.92)'; ctx.lineWidth = 3.6 * dpr; ctx.stroke();
    }
    // collectibles still in play
    const dot = (p, r, fill) => { const [x, y] = P(p); ctx.beginPath(); ctx.arc(x, y, r * dpr, 0, Math.PI * 2); ctx.fillStyle = fill; ctx.fill(); ctx.lineWidth = 1.4 * dpr; ctx.strokeStyle = ink(); ctx.stroke(); };
    const R = game.__rules;   // Gameplay.rules: live items / racers / enemies
    const items = R && Array.isArray(R.items) ? R.items : level.collectibles;
    if (mo.collectibles !== false && Array.isArray(items) && items.length < 400)
      for (const c of items) { if (!c || c.collected || c.taken || c.alive === false || c.active === false) continue; const p = c.position || c; if (p && p.x != null) dot(p, 2.2, '#ffd23f'); }
    if (Array.isArray(level.checkpoints)) for (const c of level.checkpoints) { const p = c && (c.position || c); if (p && p.x != null) dot(p, 3.4, c.reached || c.passed ? 'rgba(125,252,255,.45)' : '#7dfcff'); }
    if (level.goal && level.goal.position) {
      const [x, y] = P(level.goal.position);
      ctx.save(); ctx.translate(x, y); const s = 6 * dpr;
      for (let i = 0; i < 2; i++) for (let j = 0; j < 2; j++) { ctx.fillStyle = (i + j) % 2 ? '#111' : '#fff'; ctx.fillRect(-s + i * s, -s + j * s, s, s); }
      ctx.strokeStyle = ink(); ctx.lineWidth = 1.5 * dpr; ctx.strokeRect(-s, -s, 2 * s, 2 * s); ctx.restore();
    }
    if (R && Array.isArray(R.racers)) R.racers.forEach((r, i) => { if (!r.isPlayer && r.player && r.player.position) dot(r.player.position, 3.6, ['#ff5d5d', '#5db0ff', '#7dff8a', '#ff9de2', '#b388ff', '#ffb35d'][i % 6]); });
    if (R && Array.isArray(R.enemies)) for (const e of R.enemies) { const p = e && e.alive !== false && (e.position || (e.object && e.object.position)); if (p && p.x != null) dot(p, 3, '#ff3b3b'); }
    // extra markers (rivals, enemies): mo.markers() -> [{position, color}]
    if (typeof mo.markers === 'function') { try { for (const m of mo.markers() || []) if (m && m.position) dot(m.position, 3.2, m.color || '#ff5d5d'); } catch (e) { reportError(e); } }
    // player arrow
    const pl = playerOf(game, H);
    if (pl && pl.position) {
      const [x, y] = P(pl.position);
      let ang;
      if (pl.velocity && Math.hypot(pl.velocity.x, pl.velocity.z) > 0.6) ang = Math.atan2(pl.velocity.x, pl.velocity.z);
      else { const f = new THREE.Vector3(); game.camera.getWorldDirection(f); ang = Math.atan2(f.x, f.z); }
      M.ang = M.ang == null ? ang : M.ang + Math.atan2(Math.sin(ang - M.ang), Math.cos(ang - M.ang)) * 0.35;
      ctx.save(); ctx.translate(x, y); ctx.rotate(-M.ang + Math.PI);
      const s = 7.5 * dpr;
      ctx.beginPath(); ctx.moveTo(0, -s * 1.3); ctx.lineTo(s, s); ctx.lineTo(0, s * 0.45); ctx.lineTo(-s, s); ctx.closePath();
      ctx.fillStyle = accC; ctx.fill();
      ctx.lineWidth = 2.2 * dpr; ctx.strokeStyle = ink(); ctx.stroke();
      ctx.restore();
    }
  };
  return M;
}

// ---------- speedometer ----------
function speedometer(game, H, parent, so = {}) {
  const unit = so.unit ?? 'km/h', scale = so.scale ?? (unit === 'km/h' ? 3.6 : unit === 'mph' ? 2.237 : 1);
  let max = so.max ?? Math.round(40 * scale / 10) * 10;
  const id = ++uid;
  const A0 = 140, SW = 260, R = 40, cx = 50, cy = 52;
  const pt = (a, r = R) => [cx + Math.cos(a * Math.PI / 180) * r, cy + Math.sin(a * Math.PI / 180) * r];
  const arc = (a0, a1, r = R) => { const [x0, y0] = pt(a0, r), [x1, y1] = pt(a1, r); return `M${x0.toFixed(2)} ${y0.toFixed(2)}A${r} ${r} 0 ${a1 - a0 > 180 ? 1 : 0} 1 ${x1.toFixed(2)} ${y1.toFixed(2)}`; };
  let ticks = '';
  for (let i = 0; i <= 20; i++) { const a = A0 + SW * i / 20, big = i % 4 === 0; const [x0, y0] = pt(a, big ? 30 : 32.5), [x1, y1] = pt(a, 35.5); ticks += `<line x1="${x0.toFixed(2)}" y1="${y0.toFixed(2)}" x2="${x1.toFixed(2)}" y2="${y1.toFixed(2)}" stroke="currentColor" stroke-opacity="${big ? .9 : .45}" stroke-width="${big ? 1.6 : .9}" stroke-linecap="round"/>`; }
  const box = h('div', 'tk-speedo');
  box.innerHTML = `<svg viewBox="0 0 100 100"><defs>
    <linearGradient id="sg${id}" x1="0" y1="1" x2="1" y2="0"><stop offset="0" stop-color="var(--tk-a)"/><stop offset=".6" stop-color="var(--tk-p)"/><stop offset="1" stop-color="var(--tk-bad)"/></linearGradient>
    <radialGradient id="sb${id}" cx="50%" cy="40%" r="60%"><stop offset="0" stop-color="var(--tk-panel-a)"/><stop offset="1" stop-color="var(--tk-panel-b)"/></radialGradient></defs>
    <circle cx="${cx}" cy="${cy}" r="47" fill="url(#sb${id})" stroke="var(--tk-ink)" stroke-width="3"/>
    <circle cx="${cx}" cy="${cy}" r="44.5" fill="none" stroke="#fff" stroke-opacity=".18" stroke-width="1"/>
    <path d="${arc(A0, A0 + SW)}" fill="none" stroke="rgba(0,0,0,.45)" stroke-width="7" stroke-linecap="round"/>
    <path class="tk-sarc" d="${arc(A0, A0 + SW)}" fill="none" stroke="url(#sg${id})" stroke-width="5.5" stroke-linecap="round" pathLength="100" stroke-dasharray="0 100"/>
    ${ticks}
    <g class="tk-needle"><path d="M${cx - 2.4} ${cy - 21}L${cx} ${cy - 38}L${cx + 2.4} ${cy - 21}z" fill="var(--tk-bad)" stroke="var(--tk-ink)" stroke-width=".9" stroke-linejoin="round"/></g>
  </svg><div class="tk-sv tk-ol">0</div><div class="tk-su">${unit}</div>`;
  parent.append(box);
  const sarc = box.querySelector('.tk-sarc'), needle = box.querySelector('.tk-needle'), sv = box.querySelector('.tk-sv');
  needle.style.transformOrigin = `${cx}px ${cy}px`; needle.style.transformBox = 'view-box';
  let shown = 0, lastTxt = '', boostT = 0;
  H.offs.push(game.on('boost', () => { boostT = performance.now() + 900; }));
  return {
    update() {
      const pl = so.player || playerOf(game, H);
      let v = typeof so.value === 'function' ? so.value() : (pl && Number.isFinite(pl.speed) ? pl.speed : pl && pl.velocity ? Math.hypot(pl.velocity.x, pl.velocity.z) : num((game.state || {}).speed) ?? 0);
      v = Math.abs(v) * scale;
      if (v > max * 1.02 && so.max == null) max = Math.ceil(v / 20) * 20;
      shown += (v - shown) * 0.25;
      const f = Math.min(1, shown / max);
      sarc.setAttribute('stroke-dasharray', `${(f * 100).toFixed(2)} 100`);
      needle.style.transform = `rotate(${(A0 + SW * f + 90).toFixed(2)}deg)`;
      const t = String(Math.round(shown));
      if (t !== lastTxt) { sv.textContent = t; lastTxt = t; }
      box.classList.toggle('tk-boost', performance.now() < boostT);
    },
  };
}

// ---------- banners ----------
export function banner(game, text, opts = {}) {
  const U = ui(game);
  if (text && typeof text === 'object') { opts = { ...text, ...opts }; text = text.text ?? text.title; }   // forgive banner(game, {text, style})
  if (text == null || text === '') throw new Error('UI.banner(game, text, {style}): text is required, e.g. UI.banner(game, "Checkpoint!", {style: "checkpoint"})');
  const { style = 'info', sub = null, duration = style === 'go' ? 0.9 : 1.6 } = opts;
  if (!['go', 'stage_clear', 'checkpoint', 'warning', 'info'].includes(style)) throw new Error(`UI.banner: unknown style "${style}"; styles: go, stage_clear, checkpoint, warning, info`);
  return new Promise((resolve) => {
    const run = () => {
      U.bannerBusy = true;
      const el = h('div', `tk-banner tk-${style}${opts.mechanic ? ' tk-mechanic' : ''}`);
      if (style === 'go') el.append(h('div', 'tk-rays'));
      else el.append(h('div', 'tk-band'));
      el.append(bigText(text));
      if (sub) el.append(h('div', 'tk-sub tk-ol', [sub]));
      U.root.append(el);
      emitUi(game, style === 'go' ? 'go' : 'banner');
      const out = () => {
        el.classList.add('tk-out');
        setTimeout(() => { el.remove(); U.bannerBusy = false; resolve(); const next = U.banners.shift(); if (next) next(); }, 340);
      };
      el.__out = out;
      el.__timer = setTimeout(out, duration * 1000);
      U.bannerEl = el;
    };
    if (U.bannerBusy) {
      if (U.banners.length > 2) U.banners.shift();   // don't build a backlog
      U.banners.push(run);
      if (U.bannerEl && U.bannerEl.__out) { clearTimeout(U.bannerEl.__timer); U.bannerEl.__out(); U.bannerEl.__out = null; }
    } else run();
  });
}

// ---------- countdown ----------
export function countdown(game, opts = {}) {
  const U = ui(game);
  const { from = 3, go = 'GO!', pause = true, step = 0.85 } = opts;
  const wasPaused = game.paused;
  if (pause) game.paused = true;
  U.counting = true;
  setPhase(game, 'countdown');
  return new Promise((resolve) => {
    let n = from;
    const layer = h('div', 'tk-count');
    U.root.append(layer);
    const next = () => {
      layer.innerHTML = '';
      if (n > 0) {
        layer.append(bigText(String(n)));
        emitUi(game, 'countdown', { n });
        n--; setTimeout(next, step * 1000);
      } else {
        layer.remove();
        if (pause) game.paused = wasPaused;
        U.counting = false;
        setPhase(game, 'playing');
        banner(game, go, { style: 'go' });
        resolve();
      }
    };
    next();
  });
}

// ---------- toasts ----------
export function toast(game, text, opts = {}) {
  const U = ui(game);
  // phones: one short toast at a time; desktop: at most two (race chatter must not wall off the right third)
  const touch = U.root.classList.contains('tk-touch');
  const max = touch ? 1 : 2;
  let { icon: ic = null, duration = 2.4 } = opts;
  let txt = String(text);
  if (touch) { duration = Math.min(duration, 1.6); if (txt.length > 26) txt = txt.replace(/^(.{0,24})\b.*$/, '$1').trim() + '…'; }
  if (!U.toasts) { U.toasts = h('div', 'tk-toasts'); U.root.append(U.toasts); }
  const el = h('div', 'tk-toast' + (touch ? ' tk-compact' : ''), [wrap(panel([ic ? icon(game, ic) : null, h('span', '', [txt])]))]);
  U.toasts.append(el);
  while (U.toasts.children.length > max) U.toasts.firstChild.remove();
  emitUi(game, 'open');
  setTimeout(() => { el.classList.add('tk-out'); setTimeout(() => el.remove(), 360); }, duration * 1000);
  return el;
}

// ---------- mechanics UI: power-up timers, key ring, contextual prompt, rule toasts, mechanic banner ----------
// mechanics.js feature-detects these (and UI.hud wires them to its events), so games never call them by hand.
const POWERUP_LABEL = { speed: 'Speed', jump: 'Super Jump', shield: 'Shield', magnet: 'Magnet', giant: 'Giant', tiny: 'Tiny', invincible: 'Invincible',
  double_coins: 'Double Coins', slowmo: 'Slow-Mo', ghost: 'Ghost' };
const KEY_COLORS = { red: '#ff4d5e', blue: '#3d8bff', green: '#3cdc6a', yellow: '#ffd23f', gold: '#ffcf3a', purple: '#b47cff', orange: '#ff9a3c',
  pink: '#ff7ad9', cyan: '#3ee8ff', white: '#f4f7fb', silver: '#c9cbd8', black: '#3a3a4a' };
const keyColor = (c) => KEY_COLORS[String(c || 'gold').toLowerCase()] || (/^#|^rgb/.test(String(c)) ? c : '#ffcf3a');
function mechTray(game) {
  const U = ui(game);
  if (!U.mech) {
    const tray = h('div', 'tk-powerups'), keys = h('div', 'tk-keyring');
    U.root.append(tray, keys);
    U.mech = { tray, keys, chips: new Map(), keyEls: new Map(), tick: null };
    U.mech.tick = game.lateUpdate((dt) => {
      for (const [type, c] of U.mech.chips) {
        if (!Number.isFinite(c.left)) continue;
        c.left -= dt;
        const f = Math.max(0, c.left / c.dur);
        c.ring.setAttribute('stroke-dasharray', `${(f * 100).toFixed(2)} 100`);
        c.el.classList.toggle('tk-ending', c.left < 2.5);
        if (c.left <= 0) powerupEnd(game, type);
      }
    }, 31);
  }
  return U.mech;
}
/** UI.powerup(game, {type, duration=8, icon, label}) -> a chip with a draining ring; calling again refreshes it */
export function powerup(game, opts = {}) {
  if (typeof opts === 'string') opts = { type: opts };
  const type = String(opts.type || 'speed');
  const M = mechTray(game);
  const dur = +opts.duration > 0 ? +opts.duration : (opts.duration === Infinity ? Infinity : 8);
  let c = M.chips.get(type);
  if (!c) {
    const el = h('div', 'tk-pu');
    el.innerHTML = `<svg class="tk-pu-ring" viewBox="0 0 44 44"><circle cx="22" cy="22" r="19" class="tk-pu-track"/><circle cx="22" cy="22" r="19" class="tk-pu-fill" pathLength="100" stroke-dasharray="100 100"/></svg>`;
    el.append(icon(game, opts.icon || type, 'tk-pu-ico'), h('span', 'tk-pu-lbl tk-ol', [opts.label || POWERUP_LABEL[type] || type.replace(/_/g, ' ')]));
    M.tray.append(el);
    c = { el, ring: el.querySelector('.tk-pu-fill') };
    M.chips.set(type, c);
    emitUi(game, 'open');
  } else { c.el.classList.remove('tk-pu-bump'); void c.el.offsetWidth; c.el.classList.add('tk-pu-bump'); }
  c.dur = dur; c.left = dur;
  c.ring.setAttribute('stroke-dasharray', '100 100');
  return c.el;
}
/** UI.powerupEnd(game, type): pop the chip away (also happens when its timer runs out) */
export function powerupEnd(game, type) {
  const M = mechTray(game), c = M.chips.get(String(type));
  if (!c) return;
  M.chips.delete(String(type));
  c.el.classList.add('tk-pu-out');
  setTimeout(() => c.el.remove(), 420);
}
/** UI.keyring(game, colors[]) sets the key ring; UI.keyring(game).add(color) / .remove(color) */
export function keyring(game, colors) {
  const M = mechTray(game);
  const api = {
    add(color) {
      const k = String(color || 'gold').toLowerCase();
      if (M.keyEls.has(k)) { const e = M.keyEls.get(k); e.n = (e.n || 1) + 1; e.el.dataset.n = e.n; return api; }
      const el = h('div', 'tk-key-chip tk-pop');
      el.innerHTML = `<svg viewBox="0 0 64 64"><path d="M28 30l24 0 0 8-5 0 0 6-6 0 0-6-13 0z" fill="${keyColor(k)}" stroke="${INK}" stroke-width="3.5" stroke-linejoin="round"/><circle cx="18" cy="34" r="12" fill="${keyColor(k)}" stroke="${INK}" stroke-width="3.5"/><circle cx="18" cy="34" r="4.5" fill="${INK}"/><path d="M11 29c1-3 3-4 5-5" stroke="#fff" stroke-width="3" stroke-linecap="round" fill="none"/></svg>`;
      el.title = `${k} key`;
      M.keys.append(el); M.keyEls.set(k, { el, n: 1 });
      return api;
    },
    remove(color) {
      const k = String(color || 'gold').toLowerCase(), e = M.keyEls.get(k);
      if (!e) return api;
      if (e.n > 1) { e.n--; e.el.dataset.n = e.n > 1 ? e.n : ''; return api; }
      M.keyEls.delete(k); e.el.classList.add('tk-pu-out'); setTimeout(() => e.el.remove(), 420);
      return api;
    },
    set(list) {
      const want = new Map();
      for (const c of list || []) { const k = String(c).toLowerCase(); want.set(k, (want.get(k) || 0) + 1); }
      for (const k of [...M.keyEls.keys()]) if (!want.has(k)) { M.keyEls.get(k).n = 1; api.remove(k); }
      for (const [k, n] of want) { if (!M.keyEls.has(k)) api.add(k); const e = M.keyEls.get(k); e.n = n; e.el.dataset.n = n > 1 ? n : ''; }
      return api;
    },
  };
  if (Array.isArray(colors)) api.set(colors);
  return api;
}
/** UI.prompt(game, 'Open door', {key:'E', icon}) shows a contextual prompt; UI.prompt(game, null) hides it.
 *  On touch screens it is a tap button that presses the key. */
export function prompt(game, text, opts = {}) {
  const U = ui(game);
  if (!U.promptEl) {
    U.promptEl = h('div', 'tk-prompt');
    U.root.append(U.promptEl);
    U.promptEl.addEventListener('pointerdown', (e) => {
      if (!U.promptKey) return;
      e.preventDefault(); e.stopPropagation();
      const code = U.promptKey.length === 1 ? 'Key' + U.promptKey.toUpperCase() : U.promptKey;
      const key = code.startsWith('Key') ? code.slice(3).toLowerCase() : code === 'Space' ? ' ' : code;
      window.dispatchEvent(new KeyboardEvent('keydown', { code, key, bubbles: true }));
      setTimeout(() => window.dispatchEvent(new KeyboardEvent('keyup', { code, key, bubbles: true })), 120);
      game.emit('promptPress', U.promptKey);
      U.promptEl.classList.remove('tk-pressed'); void U.promptEl.offsetWidth; U.promptEl.classList.add('tk-pressed');
    });
  }
  const el = U.promptEl;
  if (text == null || text === false || text === '') { el.classList.remove('tk-show'); U.promptKey = null; U.promptText = null; return null; }
  const key = String(opts.key || 'E');
  if (U.promptText === text && U.promptKey === key && el.classList.contains('tk-show')) return el;
  U.promptKey = key; U.promptText = text;
  const touch = U.root.classList.contains('tk-touch');
  el.innerHTML = '';
  el.append(wrap(panel([touch ? h('span', 'tk-tapdot', ['TAP']) : h('span', 'tk-key', [key.replace(/^Key/, '').toUpperCase()]),
    opts.icon ? icon(game, opts.icon, 'tk-ico') : null, h('span', 'tk-prompt-t', [String(text)])])));
  el.classList.toggle('tk-tap', touch);
  el.classList.add('tk-show');
  return el;
}
/** UI.ruleToast(game, 'Floor is lava!', {seconds:3, icon:'rule'}) announces a rule firing, with a countdown bar */
export function ruleToast(game, text, opts = {}) {
  const U = ui(game);
  const secs = +opts.seconds > 0 ? +opts.seconds : 0;
  if (U.ruleEl) U.ruleEl.remove();
  const bar = h('div', 'tk-rule-bar'), sub = h('span', 'tk-rule-s tk-ol', [secs ? `${Math.ceil(secs)} s` : '']);
  const el = h('div', 'tk-rule', [wrap(panel([icon(game, opts.icon || 'rule', 'tk-ico'), bigText(String(text)), sub, bar]))]);
  U.root.append(el); U.ruleEl = el;
  emitUi(game, 'banner');
  const life = Math.max(1.8, secs || opts.duration || 2.2);
  if (secs) {
    bar.style.animation = `tk-rule-drain ${secs}s linear forwards`;
    const t0 = performance.now();
    const iv = setInterval(() => { const left = secs - (performance.now() - t0) / 1000; if (left <= 0 || !el.isConnected) { clearInterval(iv); return; } sub.textContent = `${Math.ceil(left)} s`; }, 200);
  } else bar.remove();
  setTimeout(() => { el.classList.add('tk-out'); setTimeout(() => el.remove(), 400); }, life * 1000);
  return el;
}
/** UI.mechanicBanner(game, 'Gravity Flip', {text:'Press G to flip gravity'}) when a custom mechanic activates */
/** UI.cutscene(game, urlOrWhen, opts) -> Promise: plays a generated cutscene (cutscene.js, kit-look-world) if the kit has it */
export async function cutscene(game, what, opts = {}) {
  try { const C = await import('./cutscene.js'); return C.play ? C.play(game, what, opts) : false; }
  catch (e) { console.warn('UI.cutscene: cutscene.js not available', e && e.message); return false; }
}
export function mechanicBanner(game, name, opts = {}) {
  return banner(game, String(name || 'New mechanic'), { style: 'info', sub: opts.text || 'New mechanic!', duration: opts.duration || 2.2, ...opts, mechanic: true });
}

// ---------- shared screen plumbing ----------
function pushKeys(U, fn) { U.keyHandlers.push(fn); return () => { const i = U.keyHandlers.indexOf(fn); if (i >= 0) U.keyHandlers.splice(i, 1); }; }
function buttons(game, U, defs, onChoose) {
  const row = h('div', 'tk-btns');
  let sel = 0;
  const els = defs.map((d, i) => {
    const b = h('button', 'tk-btn' + (d.alt ? ' tk-alt' : ''), [d.label]);
    b.addEventListener('click', (e) => { e.stopPropagation(); emitUi(game, 'click'); onChoose(d, i); });
    b.addEventListener('pointerenter', () => { sel = i; mark(); emitUi(game, 'hover'); });
    row.append(b);
    return b;
  });
  const mark = () => els.forEach((b, i) => b.classList.toggle('tk-sel', i === sel));
  mark();
  const key = (e) => {
    const vertical = row.classList.contains('tk-menu');
    const prev = vertical ? ['ArrowUp', 'KeyW'] : ['ArrowLeft', 'KeyA'], nextK = vertical ? ['ArrowDown', 'KeyS'] : ['ArrowRight', 'KeyD'];
    if (prev.includes(e.code)) { sel = (sel + els.length - 1) % els.length; mark(); emitUi(game, 'hover'); e.preventDefault(); return true; }
    if (nextK.includes(e.code)) { sel = (sel + 1) % els.length; mark(); emitUi(game, 'hover'); e.preventDefault(); return true; }
    if (e.code === 'Enter' || e.code === 'Space') { e.preventDefault(); emitUi(game, 'click'); onChoose(defs[sel], sel); return true; }
    return false;
  };
  return { row, key, els };
}
function closeScreen(el, done) { el.classList.add('tk-out'); setTimeout(() => { el.remove(); done && done(); }, 380); }
const restart = () => location.reload();

// ---------- title screen ----------
export function titleScreen(game, opts = {}) {
  const U = ui(game, opts);
  const { title = game.title || document.title || 'Game', subtitle = null, start = 'Press Space', credit = null, /* controls: 'WASD: move · Space: jump' */ pause = true, orbit = true, countdown: cd = false, logo = null } = opts;
  if (U.title) U.title.dismiss(true);
  const el = h('div', 'tk-screen tk-title');
  const sparks = h('div', 'tk-sparks');
  for (let i = 0; i < 18; i++) { const s = h('i'); s.style.left = `${(i * 53) % 100}%`; s.style.animationDelay = `${(i * 0.37) % 6}s`; s.style.animationDuration = `${5 + (i % 5)}s`; s.style.transform = `scale(${0.5 + (i % 3) * 0.3})`; sparks.append(s); }
  el.append(sparks);
  const logoEl = h('div', 'tk-logo');
  if (logo) { const img = icon(game, logo, 'tk-logo-img'); img.style.width = '5em'; img.style.height = 'auto'; logoEl.append(img); }
  else {
    // split long titles over two lines: "Starbloom" / "Peaks"
    const words = String(title).split(/\s+/);
    if (words.length >= 2 && title.length > 12) { const cut = Math.ceil(words.length / 2); logoEl.append(bigText(words.slice(0, cut).join(' ')), bigText(words.slice(cut).join(' '))); }
    else logoEl.append(bigText(title));
    const len = Math.max(...[...logoEl.children].map(c => c.textContent.length));
    logoEl.style.fontSize = `${Math.min(11, 92 / Math.max(6, len))}em`;
  }
  el.append(logoEl);
  if (subtitle) el.append(h('div', 'tk-subtitle', [wrap(panel([h('span', '', [subtitle])]))]));
  const touch = Touch.isTouch();
  const keyName = touch ? null : /space/i.test(start) ? 'Space' : /enter/i.test(start) ? 'Enter' : null;
  const startEl = h('div', 'tk-start tk-ol');
  if (keyName) { const parts = String(start).split(new RegExp(keyName, 'i')); startEl.append(parts[0] || '', h('span', 'tk-key', [keyName === 'Space' ? 'SPACE' : 'ENTER']), parts[1] || ''); }
  else startEl.append(touch ? 'Tap to start' : start);
  el.append(startEl);
  if (touch) {   // phones: a touch hint replaces the keyboard help
    const pt = (game.__player && game.__player.type) || (window.__kit && window.__kit.player && window.__kit.player.type) || 'platformer';
    const hint = pt === 'kart' || pt === 'boat' ? 'Left stick: steer · hold Drift, release to boost' : pt === 'fps' ? 'Left stick: move · drag right side: look · Fire / Jump buttons'
      : 'Left stick: move · Jump / Dash buttons · drag right side: camera';
    el.append(h('div', 'tk-controls', [hint]));
  } else if (opts.controls) el.append(h('div', 'tk-controls', [String(opts.controls)]));
  if (credit && !(touch && /wasd|arrows|space|shift|esc/i.test(credit))) el.append(h('div', 'tk-credit', [credit]));   // keyboard help is noise on a phone
  U.root.append(el);
  const wasPaused = game.paused;
  if (pause) game.paused = true;
  if (U.hud) U.hud.el.style.visibility = 'hidden';
  setPhase(game, 'title');

  // slow orbit around the level while the title is up (uses cameraOverride so the game camera is untouched)
  let ov = null, orbitFn = null;
  if (orbit) {
    try {
      const level = opts.level || levelOf(game, U.hud);
      // orbit on the survey overview: same framing the harness uses, slowly circling the level
      const ovs = survey(game, level, null).find(x => x.name === 'overview');
      const tgt = new THREE.Vector3(...ovs.target), from = new THREE.Vector3(...ovs.position);
      const c = tgt, r = Math.hypot(from.x - tgt.x, from.z - tgt.z) * 0.9, y = tgt.y + (from.y - tgt.y) * 0.75;
      const a0 = Math.atan2(from.z - tgt.z, from.x - tgt.x);
      const t0 = performance.now();
      ov = { position: new THREE.Vector3(), target: tgt.clone() };
      orbitFn = game.lateUpdate(() => {
        if (game.cameraOverride && game.cameraOverride !== ov) return;   // harness took the camera
        const a = (performance.now() - t0) / 1000 * (opts.orbitSpeed ?? 0.05) + a0;
        ov.position.set(c.x + Math.cos(a) * r, y, c.z + Math.sin(a) * r);
        game.cameraOverride = ov;
      }, 25);
    } catch (e) { reportError(e); }
  }
  let resolveP;
  const p = new Promise((r) => { resolveP = r; });
  let done = false;
  const dismiss = (silent = false) => {
    if (done) return; done = true;
    popKeys(); el.removeEventListener('pointerdown', onPtr);
    if (orbitFn) game.removeUpdate(orbitFn);
    if (ov && game.cameraOverride === ov) game.cameraOverride = null;
    U.title = null; game.__uiDismissTitle = null;
    if (U.hud) { U.hud.el.style.visibility = ''; U.hud.el.classList.add('tk-hud-in'); setTimeout(() => U.hud && U.hud.el.classList.remove('tk-hud-in'), 1500); }
    closeScreen(el);
    if (!silent) emitUi(game, 'click');
    const go = () => { if (pause) game.paused = wasPaused; setPhase(game, 'playing'); emitUi(game, 'start'); if (typeof opts.onStart === 'function') opts.onStart(); resolveP(); };
    if (cd && !silent) countdown(game, typeof cd === 'object' ? cd : {}).then(go); else go();
  };
  const popKeys = pushKeys(U, (e) => { if (e.code === 'Backquote' || e.repeat) return false; e.preventDefault(); dismiss(); return true; });
  const onPtr = () => dismiss();
  el.addEventListener('pointerdown', onPtr);
  U.title = { el, dismiss, promise: p };
  game.__uiDismissTitle = () => dismiss(true);
  // never deadlock: start the loop if the game awaited the title before game.start(), and under automation with no
  // __kit to dismiss it (setup code is still blocked behind the await), let the harness in
  setTimeout(() => { if (!game.started) game.start(); }, 0);
  setTimeout(() => { if (!done && navigator.webdriver && !(window.__kit && window.__kit.game === game)) dismiss(true); }, 2500);
  return p;
}

// ---------- pause ----------
export function pauseMenu(game, opts = {}) {
  const U = ui(game);
  if (U.pauseEl) return U.pauseEl;
  const el = h('div', 'tk-screen tk-dim tk-blur tk-pause');
  const card = h('div', 'tk-card');
  card.append(h('div', 'tk-head', [bigText(opts.title || 'Paused')]));
  const defs = [{ label: 'Resume', id: 'resume' }, { label: 'Restart', id: 'restart', alt: true }, { label: `Sound: ${Audio.isMuted() ? 'Off' : 'On'}`, id: 'sound', alt: true }];
  const B = buttons(game, U, defs, (d) => {
    if (d.id === 'resume') closePause(game, true);
    else if (d.id === 'restart') (opts.onRestart || restart)();
    else if (d.id === 'sound') { const m = Audio.mute(); B.els[2].textContent = `Sound: ${m ? 'Off' : 'On'}`; }
  });
  B.row.classList.add('tk-menu');
  card.append(B.row, h('div', 'tk-hint', ['Esc to resume']));
  el.append(card);
  U.root.append(el);
  U.pauseEl = el;
  U.pauseKeys = pushKeys(U, (e) => { if (e.code === 'Escape' || e.code === 'KeyP') { e.preventDefault(); closePause(game, true); return true; } return B.key(e); });
  if (!game.paused) { game.paused = true; game.emit('pause', true); }
  return el;
}
function closePause(game, emit) {
  const U = ui(game);
  if (!U.pauseEl) return;
  const el = U.pauseEl; U.pauseEl = null;
  U.pauseKeys && U.pauseKeys();
  closeScreen(el);
  if (game.paused) { game.paused = false; if (emit) game.emit('pause', false); }
}
export function togglePause(game) { const U = ui(game); if (U.pauseEl) closePause(game, true); else pauseMenu(game); }

// ---------- win / lose ----------
function autoStats(game) {
  const U = game.__ui, H = U && U.hud, st = game.state || {}, out = [];
  // clear time is time ELAPSED (the rules' state.time, else the HUD's own clock); a countdown adds a "Time left" row
  const el = num(st.time) ?? num(st.elapsed) ?? (H ? H.ownTime : null);
  if (el != null && (el > 0 || (H && H.timer))) { const f = fmtTime(el); out.push({ label: 'Time', value: f.main + f.frac }); }
  if (num(st.timeLeft) != null && st.timeLeft > 0) { const f = fmtTime(st.timeLeft); out.push({ label: 'Time left', value: f.main + f.frac }); }
  if (H) for (const k of H.counters) {
    const { v, t } = readCounter(game, k.c);
    const shown = t != null ? Math.min(v, t) : v, over = t != null && v > t ? v - t : 0;
    out.push({ label: k.c.label || k.c.id, value: t != null ? `${shown} / ${t}${over ? `  +${over} bonus` : ''}` : String(v), n: shown });
  }
  if (num(st.score) != null && st.score !== st.collected && !(H && H.counters.some(k => k.c.id === 'score'))) out.push({ label: 'Score', value: st.score.toLocaleString(), n: st.score });
  if (num(st.deaths) != null) out.push({ label: 'Falls', value: String(st.deaths) });
  if (num(st.position) > 0) out.push({ label: 'Place', value: `${st.position}${ordinal(st.position)}` });
  return out;
}
function autoStarCount(game) {
  const st = game.state || {}, H = game.__ui && game.__ui.hud;
  if (num(st.stars) != null) return Math.max(0, Math.min(3, st.stars));
  let s = 1;
  if (H && H.counters.length) { const all = H.counters.every(k => { const { v, t } = readCounter(game, k.c); return t == null || v >= t; }); if (all) s++; }
  else s++;
  if ((num(st.deaths) ?? 0) === 0 && (num(st.damageTaken) ?? 0) === 0 && (num(st.health) == null || st.health >= (num(st.maxHealth) ?? st.health))) s++;
  if (num(st.position) > 0) s = st.position === 1 ? 3 : st.position <= 3 ? 2 : 1;
  return Math.min(3, s);
}
function starSvg(on, u) {
  return `<svg viewBox="0 0 64 64"><defs><linearGradient id="ws${u}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${on ? '#fff7b8' : '#5d6680'}"/><stop offset=".5" stop-color="${on ? '#ffd23f' : '#3c4460'}"/><stop offset="1" stop-color="${on ? '#ff9a1f' : '#2a3048'}"/></linearGradient></defs>
    <path d="M32 5l8 16.4 18 2.6-13 12.7 3 18L32 46.2 16 54.7l3-18L6 24l18-2.6z" fill="url(#ws${u})" stroke="${INK}" stroke-width="3.5" stroke-linejoin="round"/>${on ? '<path d="M24 25l5-1.2 3-6.5" stroke="#fff" stroke-width="3" stroke-linecap="round" fill="none"/>' : ''}</svg>`;
}
function endScreen(game, kind, opts) {
  const U = ui(game);
  U.ended = true;
  if (U.screen) U.screen.remove();
  closePause(game, false);
  const el = h('div', 'tk-screen tk-dim');
  const card = h('div', 'tk-card');
  const win = kind === 'win';
  card.append(h('div', 'tk-head', [bigText(opts.title || (win ? 'Stage Clear!' : 'Game Over'))]));
  if (!win) {
    const R = { time: 'Out of time!', timeout: 'Out of time!', lives: 'Out of lives!', fell: 'You fell!', fall: 'You fell!', death: 'Knocked out!', caught: 'You got caught!' };
    const reason = opts.reason != null ? (R[opts.reason] || String(opts.reason)) : null;
    if (reason) card.append(h('div', 'tk-reason', [reason]));
  }
  if (win && opts.stars !== false) {
    const n = typeof opts.stars === 'number' ? opts.stars : autoStarCount(game);
    const row = h('div', 'tk-stars');
    for (let i = 0; i < 3; i++) {
      const s = h('span'); s.innerHTML = starSvg(i < n, ++uid);
      const svg = s.firstChild; if (i < n) { svg.classList.add('tk-on'); svg.style.animationDelay = `${0.45 + i * 0.28}s`; }
      row.append(svg);
      if (i < n) setTimeout(() => emitUi(game, 'star', { n: i + 1 }), (450 + i * 280));
    }
    card.append(row);
  }
  const stats = opts.stats || autoStats(game);
  if (stats.length) {
    const g = h('div', 'tk-stats');
    stats.forEach((s, i) => {
      const k = h('div', 'tk-k', [s.label]), v = h('div', 'tk-v', [String(s.value)]);
      k.style.animationDelay = v.style.animationDelay = `${0.5 + i * 0.12}s`;
      g.append(k, v);
      if (typeof s.n === 'number' && s.n > 1 && /^\d/.test(String(s.value))) {   // count up
        const tail = String(s.value).replace(/^[\d,]+/, ''), t0 = performance.now() + 500 + i * 120;
        const run = () => { const k2 = Math.min(1, Math.max(0, (performance.now() - t0) / 700)); v.textContent = Math.round(s.n * (1 - Math.pow(1 - k2, 3))).toLocaleString() + tail; if (k2 < 1) requestAnimationFrame(run); };
        run();
      }
    });
    card.append(g);
  }
  const defs = opts.buttons || (win ? [{ label: 'Play Again', id: 'again' }] : [{ label: 'Try Again', id: 'again' }]);
  const B = buttons(game, U, defs, (d) => { if (typeof d.action === 'function') d.action(); else (opts.onRestart || restart)(); });
  card.append(B.row);
  el.append(card);
  U.root.append(el);
  U.screen = el;
  pushKeys(U, (e) => B.key(e));
  if (U.hud) U.hud.el.style.opacity = '0.0';
  return el;
}
export function winScreen(game, opts = {}) { return endScreen(game, 'win', opts); }
export function loseScreen(game, opts = {}) { return endScreen(game, 'lose', opts); }

// ---------- dialog (cozy games: speech bubble with portrait) ----------
export function dialog(game, opts = {}) {
  const U = ui(game);
  if (typeof opts === 'string') opts = { text: opts };
  const lines = [].concat(opts.lines || opts.text || []).map(String);
  if (!lines.length) throw new Error('UI.dialog(game, {name, text | lines, portrait}): text or lines is required');
  const { name = null, portrait = null, speed = 45, pause = false } = opts;
  if (U.dialog) U.dialog.close();
  const pEl = h('div', 'tk-portrait');
  if (portrait && (/[/.]/.test(portrait) || (game.asset && game.asset(portrait)))) pEl.append(h('img', '', null, { src: /[/.]/.test(portrait) ? portrait : game.asset(portrait), alt: '' }));
  else if (portrait && ICON_SVG[portrait]) pEl.append(icon(game, portrait));
  else pEl.append(h('span', 'tk-initial tk-ol', [portrait || (name ? name[0] : '?')]));
  if (opts.color) pEl.style.background = opts.color;
  const txt = h('div', 'tk-dtext'), more = h('div', 'tk-more', ['▼']);
  const bubble = h('div', 'tk-bubble', [name ? h('div', 'tk-name', [name]) : null, txt, more]);
  const el = h('div', 'tk-dialog', [pEl, bubble]);
  U.root.append(el);
  const wasPaused = game.paused;
  if (pause) game.paused = true;
  emitUi(game, 'open');
  let i = 0, shown = 0, timer = null, resolveP;
  const p = new Promise(r => { resolveP = r; });
  const type = () => {
    const L = lines[i];
    shown = 0; txt.textContent = ''; more.style.visibility = 'hidden';
    clearInterval(timer);
    timer = setInterval(() => {
      shown = Math.min(L.length, shown + 1); txt.textContent = L.slice(0, shown);
      if (shown % 3 === 0 && L[shown - 1] !== ' ') emitUi(game, 'type');
      if (shown >= L.length) { clearInterval(timer); more.style.visibility = 'visible'; }
    }, 1000 / speed);
  };
  const advance = () => {
    if (shown < lines[i].length) { clearInterval(timer); shown = lines[i].length; txt.textContent = lines[i]; more.style.visibility = 'visible'; return; }
    emitUi(game, 'click');
    if (++i < lines.length) type(); else close();
  };
  const close = () => { clearInterval(timer); popKeys(); U.dialog = null; U.root.classList.remove('tk-dialog-open'); closeScreen(el); if (pause) game.paused = wasPaused; resolveP(); };
  const popKeys = pushKeys(U, (e) => { if (['Space', 'Enter', 'KeyE'].includes(e.code)) { e.preventDefault(); advance(); return true; } return false; });
  el.addEventListener('pointerdown', advance);
  U.dialog = { el, close };
  U.root.classList.add('tk-dialog-open');
  type();
  return p;
}
