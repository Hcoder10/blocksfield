// Blocksfield landing page: gallery from games/index.json, hero gameplay reel, small motion niceties.
(() => {
  "use strict";
  const $ = (s, el = document) => el.querySelector(s);
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;

  const STARBLOOM_PITCH = "Starbloom Peaks: a bright, sunny, juicy N64-style 3D platformer in saturated toon colours " +
    "(Super Mario 64 meets Wave Racer). Run, double-jump, long-jump, dive and ground-pound across floating meadow islands…";
  const ROBLOX_REEL = ["roblox_orbit", "roblox_hero", "roblox_dolly"].map((n) => ({
    video: `site/media/${n}.mp4`, poster: `site/media/${n}.jpg`, pitch: STARBLOOM_PITCH,
    tag: "Roblox place · Starbloom Peaks",
  }));

  // ---- nav ----
  const nav = $("#nav");
  const onScroll = () => nav.classList.toggle("scrolled", scrollY > 40);
  addEventListener("scroll", onScroll, { passive: true });
  onScroll();

  // ---- reveal on scroll + play looping videos only while visible ----
  const io = new IntersectionObserver((entries) => {
    for (const e of entries) {
      if (e.target.classList.contains("reveal") && e.isIntersecting) {
        e.target.classList.add("in");
        io.unobserve(e.target);
      }
    }
  }, { rootMargin: "0px 0px -8% 0px" });
  const watchReveals = () => document.querySelectorAll(".reveal:not(.in)").forEach((el) => io.observe(el));
  watchReveals();
  const vio = new IntersectionObserver((entries) => {
    for (const e of entries) e.isIntersecting ? e.target.play().catch(() => {}) : e.target.pause();
  }, { threshold: 0.25 });
  document.querySelectorAll("video[data-autoplay]").forEach((v) => vio.observe(v));

  // ---- Roblox clip switcher ----
  const rbxVideo = $("#rbx-video");
  $("#rbx-thumbs")?.addEventListener("click", (ev) => {
    const b = ev.target.closest("button");
    if (!b) return;
    document.querySelectorAll("#rbx-thumbs button").forEach((x) => x.classList.toggle("on", x === b));
    rbxVideo.src = b.dataset.src;
    rbxVideo.poster = b.querySelector("img").src;
    rbxVideo.play().catch(() => {});
  });

  // ---- gallery ----
  const gameUrl = (g, f) => `games/${encodeURIComponent(g.id)}/${f}`;
  function card(g) {
    const thumb = g.thumbnail ? `<img src="${esc(gameUrl(g, g.thumbnail))}" alt="" loading="lazy">` : "";
    const video = g.video ? `<video muted loop playsinline preload="none" data-src="${esc(gameUrl(g, g.video))}"></video>` : "";
    const meta = [];
    if (g.score != null) meta.push(`Judge score ${esc(g.score)}/10`);
    if (g.repairs) meta.push(`${g.repairs} repair round${g.repairs > 1 ? "s" : ""}`);
    if (g.model_calls) meta.push(`${g.model_calls} model calls`);
    if (g.minutes) meta.push(`${g.minutes} min build`);
    const making = `site/game.html?id=${encodeURIComponent(g.id)}`;
    return `<article class="card reveal${g.dev ? " dev" : ""}">
      ${g.dev ? '<span class="chip ink devlabel">DEV PLACEHOLDER</span>' : ""}
      <a class="media" href="${esc(gameUrl(g, g.play))}" tabindex="-1" aria-hidden="true">${thumb}${video}</a>
      <div class="body">
        ${g.genre ? `<span class="genre">${esc(g.genre)}</span>` : ""}
        <h3>${esc(g.title || g.id)}</h3>
        ${g.tagline ? `<p class="tagline">${esc(g.tagline)}</p>` : ""}
        ${g.pitch ? `<p class="pitch"><span>“${esc(g.pitch)}”</span></p>` : ""}
        ${meta.length ? `<p class="meta">${meta.map((m) => `<span>${m}</span>`).join("")}</p>` : ""}
        <div class="actions">
          <a class="btn sm" href="${esc(gameUrl(g, g.play))}"><i class="tri"></i>Play</a>
          ${g.dev && !g.model_calls ? "" : `<a class="btn sm ghost" href="${esc(making)}">How it was made</a>`}
        </div>
      </div>
    </article>`;
  }
  function wireHover(el) {
    const v = el.querySelector("video");
    if (!v || reduced) return;
    el.addEventListener("pointerenter", () => {
      if (!v.src) v.src = v.dataset.src;
      v.play().then(() => el.classList.add("playing")).catch(() => {});
    });
    el.addEventListener("pointerleave", () => { el.classList.remove("playing"); v.pause(); });
  }

  // ---- hero reel ----
  const reel = $("#reel");
  const vids = reel.querySelectorAll("video");
  const tag = $("#reel-tag");
  const pitchEl = $("#reel-pitch");
  const dots = $("#reel-dots");
  let items = [], cur = -1, front = 0, timer = 0, typer = 0;

  function typePitch(text) {
    clearInterval(typer);
    const caret = '<span class="caret"></span>';
    if (reduced) { pitchEl.innerHTML = esc(text) + caret; return; }
    let n = 0;
    const step = Math.max(1, Math.ceil(text.length / 60));
    typer = setInterval(() => {
      n = Math.min(text.length, n + step);
      pitchEl.innerHTML = esc(text.slice(0, n)) + caret;
      if (n >= text.length) clearInterval(typer);
    }, 28);
  }
  function show(i) {
    if (!items.length) return;
    cur = (i + items.length) % items.length;
    const it = items[cur];
    const next = vids[1 - front], prev = vids[front];
    next.poster = it.poster || "";
    next.src = it.video;
    next.currentTime = 0;
    const go = () => {
      next.style.opacity = 1; prev.style.opacity = 0;
      setTimeout(() => prev.pause(), 650);
      front = 1 - front;
    };
    next.play().then(go).catch(go);
    tag.textContent = it.tag;
    typePitch(it.pitch || "");
    dots.querySelectorAll("button").forEach((d, k) => { d.classList.toggle("on", k === cur); d.setAttribute("aria-selected", k === cur); });
    clearTimeout(timer);
    const dur = Math.max(5, Math.min(10, it.seconds || 7));
    timer = setTimeout(() => show(cur + 1), dur * 1000);
  }
  function startReel(list) {
    items = list;
    dots.innerHTML = items.map((it, k) => `<button role="tab" aria-label="${esc(it.tag)}"></button>`).join("");
    dots.querySelectorAll("button").forEach((d, k) => d.addEventListener("click", () => show(k)));
    vids.forEach((v) => v.addEventListener("loadedmetadata", () => {
      const it = items[cur];
      if (it && v.src.endsWith(it.video)) it.seconds = v.duration;
    }));
    show(0);
  }

  // ---- generalization strip: the planner's option lists, with what the listed games picked ----
  function renderRange(space, games) {
    const dims = [["level_kind", "level kinds", "Level"], ["look", "looks", "Look"], ["player_type", "player types", "Player"]]
      .filter(([k]) => (space[k] || []).length);
    if (!dims.length || !games.length) return;
    $("#gen-eq").innerHTML = dims.map(([k, label]) => `<b>${space[k].length}</b> ${label}`).join('<span class="x">×</span>') +
      '<span class="tail">, composed by the model</span>';
    $("#gen-palette").innerHTML = dims.map(([k, label]) => {
      const n = {};
      games.forEach((g) => { if (g[k]) n[g[k]] = (n[g[k]] || 0) + 1; });
      const used = Object.keys(n).length;
      return `<div><h4>${esc(label)} <span>· ${used} of ${space[k].length} used so far</span></h4><div class="opts">${space[k].map((o) =>
        `<span class="opt${n[o] ? " used" : ""}">${esc(o)}${n[o] ? `<i>${n[o]}</i>` : ""}</span>`).join("")}</div></div>`;
    }).join("");
    $("#gen-table").innerHTML = `<thead><tr><th>Game</th>${dims.map(([, , h]) => `<th>${h}</th>`).join("")}</tr></thead><tbody>${games.map((g) =>
      `<tr><td>${esc(g.title || g.id)}${g.genre ? `<small>${esc(g.genre)}</small>` : ""}</td>${dims.map(([k]) => `<td><code>${esc(g[k] || "–")}</code></td>`).join("")}</tr>`).join("")}</tbody>`;
    $("#range").hidden = false;
    watchReveals();
  }

  fetch("games/index.json", { cache: "no-cache" })
    .then((r) => (r.ok ? r.json() : { games: [] }))
    .catch(() => ({ games: [] }))
    .then((idx) => {
      const games = idx.games || [];
      const grid = $("#grid");
      grid.innerHTML = games.length ? games.map(card).join("")
        : '<div class="empty">New games are being generated. Check back soon, or watch the Roblox build below.</div>';
      if (games.length <= 2) grid.classList.add(`n${games.length}`);
      grid.querySelectorAll(".card").forEach(wireHover);
      watchReveals();
      const real = games.filter((g) => !g.dev);
      renderRange(idx.space || {}, real.length ? real : games);
      const pool = (real.length ? real : games).filter((g) => g.video);
      const first = real[0] || games[0];
      if (first) $("#play-now").href = gameUrl(first, first.play);
      startReel([
        ...pool.slice(0, 5).map((g) => ({
          video: gameUrl(g, g.video), poster: g.thumbnail ? gameUrl(g, g.thumbnail) : "", pitch: g.pitch,
          tag: `Web game · ${g.title}`,
        })),
        ...ROBLOX_REEL,
      ]);
    });
})();
