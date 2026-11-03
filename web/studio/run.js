// Blocksfield Studio: live run view. /run/<id>   ?replay=<speed> replays a finished build "live" from its files;
// ?at=<0..1> freezes it at a fraction of the way through (for screenshots).
import { $, h, esc, params, getJSON, fmtDur, fmtClock, topbar, GpuStrip, pollGpu, runGpuInfo, Seen } from './common.js';

const rid = location.pathname.split('/').filter(Boolean)[1];
topbar('run');
const root = $('#run');
root.innerHTML = `
  <section class="run-head">
    <div><div class="t1"><span class="status" id="status">…</span><span class="chip ghost" id="genre"></span><span class="chip ghost" id="rid">${esc(rid)}</span></div>
      <h1 class="display outlined" id="title">${esc(rid.replace(/_/g, ' '))}</h1><p class="tagline" id="tagline"></p>
      <p class="pitch" id="pitch"></p></div>
    <div class="clock"><div class="lbl" id="clock-lbl">Build time</div><div class="big" id="clock">0:00</div><div id="score-wrap" style="margin-top:12px"></div></div>
  </section>
  <section class="stepper" id="stepper"></section>
  <section class="board">
    <div class="col" id="col1">
      <div class="panel plan" id="plan" style="--k:var(--llm)"><h3><i class="k"></i>The plan<span class="sub">Qwen3.8-27B · lead</span></h3><div class="pb"></div></div>
      <div class="panel" id="agents" style="--k:var(--llm)"><h3><i class="k"></i>Agents<span class="sub" id="agents-sub"></span></h3><div class="agents"></div></div>
    </div>
    <div class="col" id="col2">
      <div class="panel play-final" id="final" hidden></div>
      <div class="panel" id="concepts" style="--k:var(--sun)"><h3><i class="k"></i>Concept board<span class="sub">Qwen-Image · the judge's target</span></h3><div class="cb"></div></div>
      <div class="panel" id="plays" style="--k:var(--grass)"><h3><i class="k"></i>Builder playtests<span class="sub">real Chrome · autopilot + survey cameras</span></h3><div class="pl"></div></div>
      <div class="panel" id="versions" style="--k:var(--tomato)"><h3><i class="k"></i>Judged versions<span class="sub">play score + vision score vs the concept board</span></h3><div class="vs"></div></div>
    </div>
    <div class="col" id="col3">
      <div class="panel assets" id="assets" style="--k:var(--bubble)"><h3><i class="k"></i>Generated assets<span class="sub">ComfyUI · one burst</span></h3><div class="as"></div></div>
      <div class="panel" id="logp" style="--k:var(--sky)"><h3><i class="k"></i>Build log<span class="sub" id="log-sub"></span></h3><div class="log"></div></div>
    </div>
  </section>`;
const strip = new GpuStrip(document.body, { dock: true, window: params.get('replay') ? 1500 : 600 });

const STEP = { plan: ['Plan', '1'], art: ['Art', '2'], scaffold: ['Scaffold', '3'], build: ['Build', '4'], judge: ['Judge & repair', '5'], finalize: ['Game', '6'] };
const seen = new Seen();
const last = {};
const changed = (k, v) => { const j = JSON.stringify(v); if (last[k] === j) return false; last[k] = j; return true; };
const popCls = (key) => seen.isNew(key) ? ' pop glow' : '';

// ----------------------------------------------------------------------------- sections
function renderHead(s, at) {
  const st = $('#status');
  const replay = !s.live && s.status !== 'done' && params.get('replay');
  st.className = 'status ' + (replay ? 'running' : s.status);
  st.textContent = s.status === 'running' || replay ? 'Live' : s.status === 'done' ? 'Done' : s.status;
  if (s.title) $('#title').textContent = s.title;
  $('#tagline').textContent = s.tagline || (s.plan ? '' : 'Planning the game…');
  $('#genre').textContent = (s.plan && s.plan.genre) || 'pitch';
  if (changed('pitch', s.pitch)) $('#pitch').innerHTML = `<b>PITCH</b>${esc(s.pitch || '')}`;
  const end = s.ended && s.ended <= at ? s.ended : at;
  $('#clock').textContent = fmtDur(end - s.started);
  $('#clock-lbl').textContent = s.status === 'done' ? 'Built in' : 'Build time';
  const best = (s.versions || []).find(v => v.kept);
  const sc = s.final && s.final.score != null ? s.final.score : best && best.score;
  if (changed('score', sc)) $('#score-wrap').innerHTML = sc != null ? `<span class="score-badge${s.final ? ' pop' : ''}">${(+sc).toFixed(1)}<small>/10</small></span>` : '';
}

function renderStepper(s, at) {
  const el = $('#stepper');
  const html = s.stages.map(g => {
    const [name, n] = STEP[g.name];
    const secs = g.start ? ((g.end ?? at) - g.start) : null;
    const sub = g.state === 'todo' ? '—' : g.state === 'active' ? fmtDur(secs || 0) + ' …' : fmtDur(secs || 0);
    return `<div class="step ${g.state}"><span class="ic">${g.state === 'done' ? '✓' : n}</span><div><b>${name}</b><small>${sub}</small></div></div>`;
  }).join('');
  el.innerHTML = html;
}

function renderPlan(s) {
  if (!changed('plan', s.plan)) return;
  const pb = $('#plan .pb');
  if (!s.plan) { pb.innerHTML = `<div class="empty"><div><div class="spin"></div>The lead is designing the game…</div></div>`; return; }
  const p = s.plan, c = p.player_colors || {};
  const col = p.collectible || {};
  const rows = [
    ['Look', p.look], ['Level', [p.level_kind, p.level_size].filter(Boolean).join(' · ')], ['Player', [p.player_type, p.camera && p.camera + ' cam'].filter(Boolean).join(' · ')],
    ['Collect', col.tag ? `${col.target ?? ''}${col.count ? ' of ' + col.count : ''} ${col.label || col.tag}` : null],
    ['Rules', [p.timer_seconds ? p.timer_seconds + 's timer' : null, p.lives ? p.lives + ' lives' : null, p.enemies ? p.enemies + ' enemies' : null, p.race && p.race.laps ? p.race.laps + ' laps' : null].filter(Boolean).join(' · ')],
    ['Win', p.win_condition], ['HUD', p.ui_style],
  ].filter(r => r[1]);
  pb.innerHTML = `<div class="pop glow" style="position:relative;border-radius:12px">
    <p class="loop">${esc(p.core_loop || '')}</p>
    <div class="chips">${(p.controls || []).slice(0, 4).map(x => `<span class="chip ghost">${esc(x)}</span>`).join('')}</div>
    <dl>${rows.map(([k, v]) => `<dt>${k}</dt><dd>${esc(v)}</dd>`).join('')}
      ${c.body ? `<dt>Colours</dt><dd><span class="sw" style="background:${esc(c.body)}"></span> <span class="sw" style="background:${esc(c.accent || c.body)}"></span></dd>` : ''}</dl></div>`;
}

function renderConcepts(s) {
  if (!changed('concepts', s.concepts)) return;
  const cb = $('#concepts .cb');
  if (!s.concepts.length) { cb.innerHTML = `<div class="empty" style="min-height:300px"><div><div class="spin"></div>${s.plan ? 'ComfyUI is painting the concept board…' : 'Waiting for the plan'}</div></div>`; return; }
  cb.innerHTML = `<div class="concepts">${s.concepts.map((u, i) => `<div class="c${popCls('c' + u)}"><img src="${u}" alt=""><span class="chip sun lbl">concept ${i + 1}</span></div>`).join('')}</div>`;
}

function renderAssets(s) {
  if (!changed('assets', [s.assets, s.assets_failed])) return;
  const as = $('#assets .as');
  if (!s.assets.length) { as.innerHTML = `<div class="empty"><div><div class="spin"></div>${s.concepts.length ? 'Sky, icons, music and sound are rendering…' : 'Assets come right after the concept board'}</div></div>`; return; }
  const sky = s.assets.find(a => a.kind === 'sky'), icons = s.assets.filter(a => a.kind === 'icon'), props = s.assets.filter(a => a.kind === 'prop');
  const audio = s.assets.filter(a => a.kind === 'music' || a.kind === 'sfx');
  let html = '';
  if (sky) html += `<div class="sky${popCls(sky.url)}"><img src="${sky.url}" alt=""><span class="chip sun" style="position:absolute;left:10px;bottom:10px">sky panorama</span></div>`;
  if (icons.length) html += `<div class="icons">${icons.map(a => `<div class="ic${popCls(a.url)}" title="${esc(a.prompt)}"><img src="${a.url}" alt=""><span class="lbl">${esc(a.name.replace(/^icon_/, ''))}</span></div>`).join('')}</div>`;
  if (props.length) html += `<div class="props">${props.map(a => `<div class="prop${popCls(a.url)}"><img src="${a.url}" alt=""><span class="lbl">${esc(a.name.replace(/^prop_/, ''))}</span></div>`).join('')}</div>`;
  html += audio.map((a, i) => {
    const bars = Array.from({ length: 34 }, (_, k) => `<i style="height:${18 + Math.round(70 * Math.abs(Math.sin((k + 1) * (i + 2) * 0.77) * Math.sin(k * 0.31 + i)))}%"></i>`).join('');
    return `<div class="audio${popCls(a.url)}" data-src="${a.url}" style="--c:${a.kind === 'music' ? 'var(--llm)' : 'var(--bubble)'}"><span class="pb"></span>
      <div class="nm">${esc(a.name.replace(/^(sfx|music)_/, ''))}<small>${a.kind === 'music' ? 'ACE-Step 1.5' : 'Stable Audio'} · ${esc(a.prompt || '')}</small></div><div class="wave">${bars}</div></div>`;
  }).join('');
  if (s.assets_failed && s.assets_failed.length) html += `<div class="failed-assets">${s.assets_failed.map(n => `<span class="chip" title="failed: the kit falls back to procedural">${esc(n)}</span>`).join('')}</div>`;
  as.innerHTML = html;
  as.querySelectorAll('.audio').forEach(el => el.querySelector('.pb').onclick = () => {
    const playing = el.classList.contains('on');
    as.querySelectorAll('.audio.on').forEach(x => { x.classList.remove('on'); x._a && x._a.pause(); });
    if (!playing) { el._a = el._a || new Audio(el.dataset.src); el._a.currentTime = 0; el._a.play(); el.classList.add('on'); el._a.onended = () => el.classList.remove('on'); }
  });
}

function renderPlays(s) {
  if (!changed('plays', s.plays)) return;
  const pl = $('#plays .pl');
  if (!s.plays.length) { pl.innerHTML = `<div class="empty"><div>${s.stages.find(x => x.name === 'build').state === 'active' ? '<div class="spin"></div>The builder is writing game.js; it plays it in Chrome as it goes' : 'Playtests appear once the builder starts'}</div></div>`; return; }
  const order = ['autopilot_08', 'autopilot_05', 'autopilot_04', 'player', 'survey_overview', 'title', 'after_keys'];
  const items = [];
  for (const p of s.plays) {
    const k = order.find(k => p.shots[k]) || Object.keys(p.shots)[0];
    items.push(`<div class="shot${popCls('p' + p.round + p.n)}"><img src="${p.shots[k]}" alt=""><span class="lbl">${esc(p.round.replace('_', ' '))} · play ${p.n}</span>${p.target ? `<span class="lbl r">★ ${p.collected ?? 0}/${p.target}</span>` : ''}</div>`);
  }
  pl.innerHTML = `<div class="strip">${items.reverse().join('')}</div>`;
}

function renderVersions(s) {
  if (!changed('versions', s.versions)) return;
  const vs = $('#versions .vs');
  if (!s.versions.length) { vs.innerHTML = `<div class="empty"><div>${s.stages.find(x => x.name === 'judge').state === 'active' ? '<div class="spin"></div>A bot is playing it; the vision judge compares it to the concept board' : 'Each build is played by a bot and scored'}</div></div>`; return; }
  const bar = (lbl, v, c) => `<div class="bar2" style="--c:${c}"><span>${lbl}</span><span class="tr"><i style="width:${(v || 0) * 10}%"></i></span><b>${v != null ? (+v).toFixed(1) : '–'}</b></div>`;
  vs.innerHTML = `<div class="versions">${s.versions.map(v => {
    const img = v.shots.autopilot_08 || v.shots.autopilot_04 || v.shots.player || v.shots.survey_overview || Object.values(v.shots)[0];
    const label = v.tag.startsWith('s') ? 'scaffold' : v.tag === 'v0' ? 'builder' : 'repair ' + v.tag.slice(1);
    return `<div class="ver${v.kept ? ' kept' : ''}${popCls('v' + v.tag)}"><div class="img">${img ? `<img src="${img}" alt="">` : ''}</div>
      <div class="vb"><div class="tag">${esc(v.tag)}<small>${label}</small></div><div class="total">${v.score != null ? (+v.score).toFixed(2) : '–'}</div>
        <div class="bars">${bar('play', v.play, 'var(--grass)')}${bar('vision', v.vision, 'var(--sun)')}</div>
        ${v.target ? `<div class="note">autopilot: ${v.collected ?? 0}/${v.target} collected, moved ${Math.round(v.moved || 0)} m${v.won ? ', won' : ''}${v.errors ? `, ${v.errors} error(s)` : ''}</div>` : ''}</div></div>`;
  }).join('')}</div>`;
}

const TOOL_CLS = (t) => /play/.test(t) ? 'play' : /edit|write|patch/.test(t) ? 'edit' : /doc|read|search|list/.test(t) ? 'doc' : '';
function renderAgents(s, at) {
  const key = [s.agents.map(a => a.label), s.working && s.working.label];
  const ag = $('#agents .agents');
  if (changed('agents', key)) {
    const cards = s.agents.slice().reverse().map(a => `<div class="agent${popCls('a' + a.label)}"><div class="ah"><span class="chip ${a.role === 'lead' ? 'sun' : 'llm'}">${esc(a.role)}</span><b>${esc(a.label.replace('_', ' '))}</b><span class="sp"></span>
      <span class="m">${fmtDur(a.seconds)} · ${((a.tokens || 0) / 1000).toFixed(0)}k tok</span></div>
      ${a.steps.length ? `<div class="steps">${a.steps.slice(-26).map(x => `<span class="${TOOL_CLS(x.tool)}">${esc(x.tool)}${x.arg ? ' ' + esc(x.arg) : ''}</span>`).join('')}</div>` : ''}
      ${a.summary ? `<p class="sum">${esc(a.summary)}</p>` : ''}</div>`);
    if (s.working) cards.unshift(`<div class="agent working${popCls('w' + s.working.label)}"><div class="ah"><span class="chip llm">${esc(s.working.role)}</span><b>${esc(s.working.label.replace('_', ' '))}</b><span class="sp"></span><span class="m" id="work-t"></span></div>
      <p class="sum">${s.working.role === 'builder' ? 'Reading the kit docs, writing game.js and playing it in Chrome…' : 'Designing the game as schema-checked JSON…'}</p></div>`);
    ag.innerHTML = cards.join('') || `<div class="empty"><div><div class="spin"></div>Starting…</div></div>`;
  }
  const wt = $('#work-t'); if (wt && s.working) wt.textContent = fmtDur(at - s.working.since) + ' …';
  const tok = s.agents.reduce((a, x) => a + (x.tokens || 0), 0);
  $('#agents-sub').textContent = s.agents.length ? `${s.agents.length} call${s.agents.length > 1 ? 's' : ''} · ${(tok / 1000).toFixed(0)}k tokens` : 'Qwen3.8-27B';
}

function renderLog(s) {
  if (!changed('log', s.log.map(l => l.t + l.text))) return;
  const lg = $('#logp .log');
  lg.innerHTML = s.log.map(l => `<div class="${l.kind}${seen.isNew('l' + l.t + l.text) ? ' pop' : ''}"><time>${fmtClock(l.t)}</time><span>${esc(l.text)}</span></div>`).join('');
  $('#log-sub').textContent = 'runs/web_' + rid + '/build.log';
}

function renderFinal(s) {
  const f = s.final;
  const el = $('#final');
  if (!f || !f.game) { el.hidden = true; return; }
  if (!changed('final', f)) return;
  el.hidden = false;
  el.className = 'panel play-final' + popCls('final');
  el.innerHTML = `<div class="bar"><span class="status done">Ready</span><h3>${esc(f.title || s.title || '')}</h3><span class="sp"></span>
      ${f.video ? `<button class="btn sm ghost" id="vid">Gameplay video</button>` : ''}<a class="btn sm" href="${f.game}" target="_blank"><i class="tri"></i>Open</a></div>
    <div class="frame"><div class="poster" id="poster">${f.thumb ? `<img src="${f.thumb}" style="width:100%;height:100%;object-fit:cover">` : ''}
      <span class="btn big big-play"><i class="tri"></i>Play here</span></div></div>`;
  const frame = el.querySelector('.frame');
  el.querySelector('#poster').onclick = () => { frame.innerHTML = `<iframe src="${f.game}" allow="autoplay; fullscreen; gamepad" allowfullscreen></iframe>`; };
  const vb = el.querySelector('#vid');
  if (vb) vb.onclick = () => { frame.innerHTML = `<video src="${f.video}" autoplay muted loop playsinline></video>`; };
  if (params.get('autoplay') === 'video' && f.video) frame.innerHTML = `<video src="${f.video}" autoplay muted loop playsinline></video>`;
  if (params.get('autoplay') === 'game') frame.innerHTML = `<iframe src="${f.game}" allow="autoplay; fullscreen; gamepad" allowfullscreen></iframe>`;
}

// ----------------------------------------------------------------------------- loop
let liveGpu = null;
let snap = null;
const replaySpeed = +params.get('replay') || 0;
const atFrac = params.get('at');
let replayT0 = null;

async function refresh() {
  let at = null;
  if (snap && (replaySpeed || atFrac != null)) {
    const r = snap.replay;
    if (atFrac != null) at = r.start + (+atFrac) * (r.end - r.start);
    else { replayT0 = replayT0 ?? performance.now() - (+params.get('from') || 0) * 1000 / replaySpeed; at = r.start + (performance.now() - replayT0) / 1000 * replaySpeed; if (at > r.end + 2) at = r.end + 2; }
  }
  try {
    snap = await getJSON(`/api/run/${rid}${at ? `?at=${at}` : ''}`);
  } catch (e) { $('#title').textContent = `No run "${rid}"`; return; }
  if (!at && (replaySpeed || atFrac != null)) return refresh();   // first fetch only learned the replay window
  const t = snap.at;
  document.title = `${snap.title || rid} · Blocksfield Studio`;
  renderHead(snap, t); renderStepper(snap, t); renderPlan(snap); renderConcepts(snap); renderAssets(snap);
  renderPlays(snap); renderVersions(snap); renderAgents(snap, t); renderLog(snap); renderFinal(snap);
  seen.done();
  if (!(liveGpu && snap.live)) {
    const done = snap.status === 'done' && snap.ended;
    strip.render(snap.gpu.map(g => ({ ...g })), t, runGpuInfo(snap, t), done ? { start: snap.started - 20, end: snap.ended + 20 } : null);
  }
}
refresh();
setInterval(refresh, replaySpeed ? 700 : 2000);
// live arbiter when this run is live and the tunnel is up; otherwise the strip shows the run's own history
pollGpu((g) => { liveGpu = g.online && snap && snap.live && snap.status === 'running' ? g : null; if (liveGpu) strip.render(g.segs, g.now, g.info); });
