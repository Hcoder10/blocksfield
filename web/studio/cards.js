// game cards shared by the Create page and the Games page
import { esc, h } from './common.js';
export function card(r) {
  const el = h('a', 'card');
  el.href = `/run/${r.id}`;
  const st = r.status === 'running' ? '<span class="status running">Building</span>' : r.status === 'done' ? '' : `<span class="status ${r.status}">${esc(r.status)}</span>`;
  el.innerHTML = `<div class="media">${r.thumb ? `<img src="${r.thumb}" alt="" loading="lazy">` : ''}${r.video ? `<video src="${r.video}" muted loop playsinline preload="none"></video>` : ''}
      ${st}${r.score != null ? `<span class="score score-badge">${(+r.score).toFixed(1)}<small>/10</small></span>` : ''}</div>
    <div class="body"><span class="chip ghost" style="align-self:flex-start;margin-bottom:4px">${esc(r.genre || 'game')}</span><h3>${esc(r.title)}</h3>
      <p class="tagline">${esc(r.tagline || '')}</p><div class="last">${esc(r.last || '')}</div></div>`;
  const v = el.querySelector('video');
  if (v) { el.addEventListener('mouseenter', () => { v.preload = 'auto'; v.play().catch(() => {}); }); el.addEventListener('mouseleave', () => v.pause()); }
  return el;
}
