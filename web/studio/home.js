// Blocksfield Studio: Create page (pitch box, live GPU strip, recent games).
import { $, getJSON, topbar, GpuStrip, pollGpu, runGpuInfo, toast, params } from './common.js';
import { card } from './cards.js';

topbar('create');
const EX = {
  platformer: 'Cloudhop Meadows: a bright, juicy 3D platformer across floating sky islands. Run, double-jump and dash between candy-coloured islands, collect glowing star seeds, dodge spinning thorn bars and reach the giant blooming flower portal at the top. Cheerful music and a bouncy HUD.',
  kart: 'Turbo Tides: a neon kart race around a twisty seaside track at night. Drift through glowing corners, hit boost pads and beat five rival racers over three laps. Synthwave music, a speedometer, a minimap and a big GO! countdown.',
  cozy: 'Lantern Lane: a cozy village at golden hour. Wander cobbled streets as a little fox, find the 20 lost festival lanterns and bring them to the square before the moon rises. Soft acoustic music and a warm, rounded HUD.',
  neon: 'Pulse Arena: a neon sci-fi arena at night. Dash around a glowing circular arena collecting energy cores while laser sweepers and drones hunt you. A 90-second timer, pounding synth music and a sleek cyan HUD.',
};
const ta = $('#pitch'), slugEl = $('#slug'), pc = $('#pitch-card');
const slug = (t) => (t.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').split('_').slice(0, 4).join('_').slice(0, 32)) || '…';
const titleOf = (t) => { const m = t.match(/^([^:.!?]{3,40}):/); return m ? m[1] : t; };
const upd = () => { slugEl.textContent = slug(titleOf(ta.value)); };
ta.addEventListener('input', upd);
ta.addEventListener('focus', () => pc.classList.add('focus'));
ta.addEventListener('blur', () => pc.classList.remove('focus'));

// typewriter: example chips type their pitch in, like someone writing it
let typing = null;
function typeIn(text, cps = 70) {
  clearInterval(typing);
  ta.value = ''; ta.focus(); let i = 0;
  typing = setInterval(() => { i = Math.min(text.length, i + Math.max(1, Math.round(cps / 30))); ta.value = text.slice(0, i); upd(); if (i >= text.length) clearInterval(typing); }, 33);
}
document.querySelectorAll('.ex').forEach(c => c.onclick = () => typeIn(EX[c.dataset.ex]));
// rotating placeholder
const ph = ['A neon kart race around a seaside track at night…', 'A cozy village where a fox collects lost lanterns…', 'A sky-island platformer with star seeds and thorn bars…'];
let phi = 0; ta.placeholder = ph[0]; setInterval(() => { if (!ta.value) ta.placeholder = ph[++phi % ph.length]; }, 3500);
if (params.get('type')) setTimeout(() => typeIn(EX[params.get('type')] || params.get('type'), +params.get('cps') || 70), 600);

$('#make').onclick = async () => {
  const pitch = ta.value.trim();
  if (pitch.length < 20) { toast('Write a pitch first: one paragraph about the game you want.'); ta.focus(); return; }
  const r = await fetch('/api/make', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pitch, title: titleOf(pitch) }) });
  const d = await r.json();
  if (d.ok) { location.href = `/run/${d.id}`; return; }
  toast(d.error || 'Could not start the build');
  if (r.status === 403 && runs.length) setTimeout(() => { location.href = `/run/${(runs.find(x => x.status === 'running') || runs[0]).id}?replay=40`; }, 1800);
};

// live GPU strip; when the arbiter is offline it shows the latest build's history
const strip = new GpuStrip($('#gpu'), { window: 900 });
let runs = [], fallback = null;
pollGpu((g) => {
  if (g.online) { strip.render(g.segs, g.now, g.info); return; }
  if (fallback) { const s = fallback; strip.render(s.gpu, s.ended || s.at, { ...runGpuInfo(s, s.ended || s.at), src: `latest build · ${s.title || s.id}` }, s.ended ? { start: s.started - 20, end: s.ended + 20 } : null); }
});

async function loadRuns() {
  const d = await getJSON('/api/runs');
  runs = d.runs;
  const el = $('#cards'); el.innerHTML = '';
  runs.slice(0, 6).forEach(r => el.append(card(r)));
  if (runs[0] && !fallback) fallback = await getJSON(`/api/run/${runs[0].id}`);
  const sc = runs.find(r => r.video);
  const scEl = $('#showcase');
  if (sc && scEl.dataset.id !== sc.id) {
    scEl.dataset.id = sc.id; scEl.href = `/run/${sc.id}`;
    const v = scEl.querySelector('video'); v.src = sc.video; v.play().catch(() => {});
    $('#sc-title').textContent = sc.title; $('#sc-pitch').textContent = sc.pitch || sc.tagline || '';
  }
}
loadRuns(); setInterval(loadRuns, 20000);
