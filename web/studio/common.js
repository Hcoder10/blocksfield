// Blocksfield Studio: shared bits (top bar, GPU strip, helpers).
export const $ = (s, el = document) => el.querySelector(s);
export const h = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; };
export const esc = (s) => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
export const params = new URLSearchParams(location.search);
export async function getJSON(url) { const r = await fetch(url, { cache: 'no-store' }); if (!r.ok) throw new Error(`${r.status} ${url}`); return r.json(); }
export function fmtDur(s) {
  s = Math.max(0, Math.round(s || 0));
  const hh = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60;
  return hh ? `${hh}:${String(m).padStart(2, '0')}:${String(x).padStart(2, '0')}` : `${m}:${String(x).padStart(2, '0')}`;
}
export const fmtClock = (t) => new Date(t * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });

export function topbar(active) {
  const el = h('header', 'top', `
    <a class="brand" href="/"><img src="/site/img/cube.svg" alt=""><b>BLOCKSFIELD</b><span class="tag">Studio</span></a>
    <nav><a href="/" class="${active === 'create' ? 'on' : ''}">Create</a><a href="/runs" class="${active === 'runs' ? 'on' : ''}">Games</a>
      <a href="/index.html" target="_blank">Gallery</a></nav>
    <div class="grow"></div>
    <div class="gpu-pill" id="gpu-pill"><span class="dot"></span><span><span class="gpu">RTX 5090 ·</span> <span id="gpu-pill-t">connecting…</span></span></div>`);
  document.body.prepend(el);
  return el;
}

// ---------------------------------------------------------------------------------------------- GPU strip
const KIND_NAME = { llm: 'Qwen3.8-27B', judge: 'Vision judge', art: 'ComfyUI', snd: 'ComfyUI · audio', swap: 'swap' };
const artKind = (name = '') => /music|sfx|audio|ace|sound/i.test(name) ? 'snd' : 'art';
const prettyJob = (name = '') => {
  const n = String(name).replace(/\.json$/, '');
  if (/music|ace/i.test(n)) return 'ACE-Step · music';
  if (/sfx|stable_audio|sound/i.test(n)) return 'Stable Audio · sfx';
  if (/splat|idol|trellis|prop/i.test(n)) return 'Idol · 3D prop';
  if (/concept/i.test(n)) return 'Qwen-Image · concept';
  if (/sky|pano/i.test(n)) return 'Qwen-Image · sky';
  if (/icon/i.test(n)) return 'Qwen-Image · icon';
  return 'Qwen-Image · ' + n.replace(/^qwen_?image_?/i, '').replace(/_/g, ' ').slice(0, 18) || 'image';
};

// arbiter events -> lane segments (LLM calls merged into blocks)
export function arbiterSegments(d) {
  const segs = [];
  let blk = null;
  const llm = d.events.filter(e => e.kind === 'llm').sort((a, b) => a.start - b.start);
  for (const e of llm) {
    if (blk && e.start - blk.end < 4) { blk.end = Math.max(blk.end, e.end); blk.tokens += e.tokens || 0; }
    else { blk = { kind: 'llm', start: e.start, end: e.end, tokens: e.tokens || 0 }; segs.push(blk); }
  }
  for (const e of d.events) {
    if (e.kind === 'art') segs.push({ kind: artKind(e.name), start: e.start, end: e.end, name: e.name, thumbs: e.thumbs || [] });
    else if (e.kind === 'sleep' || e.kind === 'wake') segs.push({ kind: 'swap', start: e.start, end: Math.max(e.end, e.start + 1.5), name: e.name });
  }
  const now = d.now;
  if (d.mode === 'art' && d.current) {
    const last = Math.max(0, ...d.events.filter(e => e.kind !== 'llm').map(e => e.end));
    segs.push({ kind: artKind(d.current), start: last || now - 5, end: null, name: d.current });
  } else if (d.inflight_llm > 0) {
    if (blk && now - blk.end < 30) blk.end = null; else segs.push({ kind: 'llm', start: now - 2, end: null });
  }
  return segs;
}

export class GpuStrip {
  constructor(parent, { dock = false, window = 600 } = {}) {
    this.window = window;
    this.el = h('div', 'gpu-strip' + (dock ? ' dock' : ''), `
      <div class="who"><div class="k">Holding the RTX 5090</div><div class="now"><i></i><span>—</span></div><div class="what2"></div>
        <div class="nums"></div></div>
      <div class="tl"><div class="src"></div><div class="legend"><span><i style="background:var(--llm)"></i>Qwen3.8-27B</span><span><i style="background:var(--judge)"></i>judge</span><span><i style="background:var(--art)"></i>Qwen-Image / Idol</span><span><i style="background:var(--snd)"></i>ACE-Step / Stable Audio</span><span><i style="background:var(--swap)"></i>swap</span></div>
        <div class="ticks"></div><div class="lane l-llm"><span class="lane-name">LLM</span></div><div class="lane l-art"><span class="lane-name">ComfyUI</span></div><div class="nowline"></div></div>`);
    parent.append(this.el);
    this.tl = this.el.querySelector('.tl');
    this.lanes = { llm: this.el.querySelector('.l-llm'), art: this.el.querySelector('.l-art') };
    this.segEls = new Map();
    this.thumbEls = new Map();
  }
  // segs: [{kind, start, end|null, name, thumbs}], now: epoch, info: {holder, what, nums, src}
  render(segs, now, info = {}, range = null) {
    // range {start, end}: show a whole finished build instead of the trailing window
    const W = range ? Math.max(60, range.end - range.start) : this.window, t0 = range ? range.start : now - W;
    this.el.querySelector('.nowline').style.display = range ? 'none' : '';
    if (range) now = range.end;
    const pct = (t) => ((t - t0) / W) * 100;
    const right = 14 / (this.tl.clientWidth || 1200) * 100;       // the NOW line sits 14px from the edge
    const X = (t) => pct(t) * (1 - right / 100);
    const seen = new Set();
    for (const s of segs) {
      const end = s.end ?? now;
      if (end < t0) continue;
      const key = `${s.kind}|${s.start}`;
      seen.add(key);
      let el = this.segEls.get(key);
      if (!el) {
        el = h('div', `seg ${s.kind}`);
        (s.kind === 'llm' || s.kind === 'judge' ? this.lanes.llm : this.lanes.art).append(el);
        this.segEls.set(key, el);
      }
      el.classList.toggle('open', s.end == null);
      const a = Math.max(0, X(s.start)), b = X(end);
      el.style.left = a + '%'; el.style.width = Math.max(0.25, b - a) + '%';
      el.title = `${KIND_NAME[s.kind] || s.kind}${s.name ? ' · ' + s.name : ''} · ${Math.round(end - s.start)}s`;
      if (s.thumbs && s.thumbs.length && !this.thumbEls.has(key)) {
        const tw = h('div', 'thumbs pop');
        for (const id of s.thumbs.slice(0, 3)) { const im = h('img'); im.src = `/api/gpu/thumb/${id}`; im.onerror = () => im.remove(); tw.append(im); }
        this.tl.append(tw); this.thumbEls.set(key, { el: tw, s });
      }
    }
    for (const [k, el] of this.segEls) if (!seen.has(k)) { el.remove(); this.segEls.delete(k); }
    for (const [k, v] of this.thumbEls) {
      if (!seen.has(k)) { v.el.remove(); this.thumbEls.delete(k); continue; }
      v.el.style.left = `calc(${Math.max(0, X(v.s.start))}% + 4px)`;
    }
    // ticks every minute (or 5 for long windows)
    const step = W > 5400 ? 900 : W > 2400 ? 600 : W > 1200 ? 300 : W > 700 ? 120 : 60;
    let html = '';
    for (let t = Math.ceil(t0 / step) * step; t < now - step * 0.15; t += step) html += `<span style="left:${X(t)}%">${fmtClock(t).slice(0, 5)}</span>`;
    this.el.querySelector('.ticks').innerHTML = html;
    // who holds the card
    const nowEl = this.el.querySelector('.now');
    nowEl.className = 'now ' + (info.kind || '');
    nowEl.querySelector('span').textContent = info.holder || '—';
    this.el.querySelector('.what2').textContent = info.what || '';
    this.el.querySelector('.nums').innerHTML = info.nums || '';
    this.el.querySelector('.src').textContent = info.src || '';
  }
}

// one poller of /api/gpu shared by the page; calls back with {online, segs, now, info}
export function pollGpu(cb, every = 1500) {
  let since = Date.now() / 1000 - 3 * 3600;
  const pill = document.getElementById('gpu-pill');
  const tick = async () => {
    try {
      const d = await getJSON(`/api/gpu?since=${since}`);
      if (!d.online || !d.now) { pill && (pill.className = 'gpu-pill'); pill && (pill.querySelector('#gpu-pill-t').textContent = 'arbiter offline'); cb({ online: false }); return; }
      const segs = arbiterSegments(d);
      const last60 = d.events.filter(e => e.kind === 'llm' && e.end > d.now - 60).reduce((a, e) => a + (e.tokens || 0), 0);
      let kind, holder, what;
      if (d.mode === 'art') { kind = artKind(d.current || ''); holder = 'ComfyUI'; what = d.current ? prettyJob(d.current) + (d.art_queue ? ` · ${d.art_queue} queued` : '') : 'swapping in'; }
      else if (d.inflight_llm > 0) { kind = 'llm'; holder = 'Qwen3.8-27B'; what = `${d.inflight_llm} request${d.inflight_llm > 1 ? 's' : ''} in flight · vLLM`; }
      else { kind = 'llm'; holder = d.llm_loaded === false ? 'Swapping' : 'Qwen3.8-27B'; what = 'loaded, idle · vLLM'; }
      const info = { kind, holder, what, src: 'live · arbiter',
        nums: `<span><b>${Math.round(last60 / 60)}</b> tok/s</span><span><b>${d.swaps ?? 0}</b> swaps</span><span><b>${d.art_jobs ?? 0}</b> art jobs</span>` };
      if (pill) { pill.className = 'gpu-pill ' + (kind === 'snd' ? 'art' : kind); pill.querySelector('#gpu-pill-t').textContent = kind === 'llm' ? (d.inflight_llm > 0 ? 'LLM thinking' : 'LLM idle') : 'ComfyUI rendering'; }
      cb({ online: true, segs, now: d.now, info });
    } catch (e) { cb({ online: false }); }
  };
  tick();
  return setInterval(tick, every);
}

// segments reconstructed from a run's build log (offline / replay)
export function runGpuInfo(snap, at) {
  const open = (snap.gpu || []).find(s => s.end == null || s.end > at && s.start <= at);
  const kind = open ? (open.kind === 'judge' ? 'llm' : open.kind) : null;
  const holder = !open ? (snap.status === 'done' ? 'Done' : 'Idle') : open.kind === 'art' ? 'ComfyUI' : open.kind === 'judge' ? 'Qwen3.8-27B' : 'Qwen3.8-27B';
  const what = !open ? '' : open.kind === 'art' ? 'concept board, sky, icons, music, sfx, props' : open.kind === 'judge' ? 'vision judge vs the concept board' : open.name === 'plan' ? 'lead agent · designing the plan' : `${(open.name || 'builder').replace('_', ' ')} agent · writing game.js`;
  const llmS = (snap.gpu || []).filter(s => s.kind !== 'art').reduce((a, s) => a + ((s.end ?? at) - s.start), 0);
  const artS = (snap.gpu || []).filter(s => s.kind === 'art').reduce((a, s) => a + ((s.end ?? at) - s.start), 0);
  return { kind, holder, what, src: 'this build · from its log', nums: `<span>LLM <b>${fmtDur(llmS)}</b></span><span>ComfyUI <b>${fmtDur(artS)}</b></span>` };
}

// remember what we've shown so new things can pop in
export class Seen {
  constructor() { this.s = new Set(); this.first = true; }
  isNew(key) { if (this.s.has(key)) return false; this.s.add(key); return !this.first; }
  done() { this.first = false; }
}

export function toast(msg, ms = 3200) {
  const t = h('div', 'toast', esc(msg)); document.body.append(t); setTimeout(() => t.remove(), ms);
}
