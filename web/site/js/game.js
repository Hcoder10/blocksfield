// Making-of page: renders games/<id>/about.json (+ assets/assets.json) written by blocksfield/web_run.py.
(() => {
  "use strict";
  const $ = (s, el = document) => el.querySelector(s);
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const nf = new Intl.NumberFormat("en-US");
  const fmtS = (s) => (s >= 90 ? `${(s / 60).toFixed(s >= 600 ? 0 : 1)} min` : `${Math.round(s)} s`);
  const title = (s) => String(s).replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase());

  const nav = $("#nav");
  addEventListener("scroll", () => nav.classList.toggle("scrolled", scrollY > 40), { passive: true });

  const id = new URLSearchParams(location.search).get("id") || "";
  const base = `../games/${encodeURIComponent(id)}/`;
  const url = (f) => base + String(f).split("/").map(encodeURIComponent).join("/");
  const getJSON = (u) => fetch(u, { cache: "no-cache" }).then((r) => (r.ok ? r.json() : null)).catch(() => null);

  function fail(msg) {
    $("#g-title").textContent = "Game not found";
    $("#g-tagline").innerHTML = `${esc(msg)} <a href="../index.html#games">Back to all games</a>.`;
    $("#g-body").hidden = true;
    document.querySelectorAll(".mk-hero .hero-cta, .mk-hero .reel-wrap, .nav-links").forEach((el) => el.remove());
  }
  if (!/^[\w.-]+$/.test(id)) return fail("No game id in the link.");

  Promise.all([getJSON(base + "about.json"), getJSON(base + "assets/assets.json")]).then(([a, assets]) => {
    if (!a) return fail(`No record for "${id}".`);
    render(a, assets || {});
  });

  function render(a, assets) {
    const plan = a.plan || {};
    document.title = `${a.title || id}: how it was made · Blocksfield`;
    $("#g-title").textContent = a.title || id;
    $("#g-tagline").textContent = a.tagline || "";
    const play = url(a.play || "index.html");
    document.querySelectorAll("#g-play, #g-play2").forEach((el) => (el.href = play));

    // facts
    const t = a.timings_s || {};
    const calls = Object.values(a.model_calls || {}).reduce((n, r) => n + (r.calls || 0), 0);
    const repairs = Object.keys(t).filter((k) => k.startsWith("repair_")).length;
    const total = Object.values(t).reduce((n, s) => n + s, 0);
    const facts = [];
    if (a.genre) facts.push(`<span class="chip sun">${esc(a.genre)}</span>`);
    if (a.score?.score != null) facts.push(`<span class="chip">Judge score ${esc(a.score.score)}/10</span>`);
    if (total) facts.push(`<span class="chip grass">Built in ${fmtS(total)}</span>`);
    if (calls) facts.push(`<span class="chip sky">${nf.format(calls)} model calls</span>`);
    if (repairs) facts.push(`<span class="chip pink">${repairs} repair round${repairs > 1 ? "s" : ""}</span>`);
    if (a.dry_run) facts.push('<span class="chip ink">DEV: dry run, fake models</span>');
    $("#g-facts").innerHTML = facts.join("");
    const ctrls = a.controls || plan.controls || [];
    $("#g-controls").innerHTML = ctrls.map((c) => {
      const [k, v] = String(c).split(/:\s*/, 2);
      return v ? `<span><kbd>${esc(k)}</kbd> ${esc(v)}</span>` : `<span>${esc(c)}</span>`;
    }).join("");

    // hero media
    const scr = $("#g-screen");
    if (a.video) {
      scr.innerHTML = `<video src="${esc(url(a.video))}" ${a.thumbnail ? `poster="${esc(url(a.thumbnail))}"` : ""} muted loop autoplay playsinline></video>
        <span class="chip ink tag">Autopilot gameplay, recorded by the pipeline</span>`;
    } else if (a.thumbnail) {
      scr.innerHTML = `<img src="${esc(url(a.thumbnail))}" alt="">`;
    }

    // pitch
    $("#g-pitch").textContent = a.pitch || "";

    // plan
    const rows = [];
    const add = (k, v, cls = "") => v !== undefined && v !== null && v !== "" && rows.push(
      `<div class="spec-item ${cls}"><dt>${esc(k)}</dt><dd>${v}</dd></div>`);
    add("Core loop", esc(plan.core_loop), "wide");
    add("Win", esc(plan.win_condition));
    add("Lose", esc(plan.lose_condition));
    add("Art direction", esc(plan.art_direction), "wide");
    add("Look", plan.look && `<code>${esc(plan.look)}</code>`);
    add("Level", plan.level_kind && `<code>${esc(plan.level_kind)}</code>${plan.level_size ? ` · ${esc(plan.level_size)}` : ""}`);
    add("Player", plan.player_type && `<code>${esc(plan.player_type)}</code>${plan.camera ? ` · ${esc(plan.camera)} camera` : ""}`);
    if (plan.player_colors) add("Player colours", Object.entries(plan.player_colors).map(([k, c]) =>
      `<span class="sw" style="background:${esc(c)}"></span>${esc(k)}`).join(" "));
    const col = plan.collectible;
    if (col && col.count) add("Collect", `${esc(col.count)} ${esc(col.label || col.tag)}${col.target ? `, need ${esc(col.target)}` : ""}`);
    if (plan.race && plan.race.laps) add("Race", `${esc(plan.race.laps)} laps vs ${esc(plan.race.opponents)} opponents`);
    if (plan.enemies) add("Enemies", esc(plan.enemies));
    if (plan.lives) add("Lives", esc(plan.lives));
    if (plan.timer_seconds) add("Timer", `${esc(plan.timer_seconds)} s`);
    if (plan.goal) add("Goal", "Reach the goal");
    if (plan.features?.length) add("Extras", plan.features.map(esc).join(" · "), "wide");
    $("#g-plan").innerHTML = rows.join("");

    // concept vs result
    const shots = plan.concept_shots || [];
    const concepts = (a.concepts || []).map((c, i) =>
      `<figure><img src="${esc(url(c))}" alt="Concept art ${i + 1}" loading="lazy"><figcaption><b>Concept ${i + 1}</b>${shots[i] ? ` · “${esc(shots[i])}”` : ""}</figcaption></figure>`);
    const result = a.survey ? `<figure class="result"><img src="${esc(url(a.survey))}" alt="Survey of the final build" loading="lazy"><figcaption><b>The final build</b> · what the judge saw: the player's view plus survey cameras</figcaption></figure>`
      : (a.thumbnail ? `<figure class="result"><img src="${esc(url(a.thumbnail))}" alt="The final build" loading="lazy"><figcaption><b>The final build</b></figcaption></figure>` : "");
    $("#g-concept").innerHTML = concepts.length || result
      ? `<div class="vs-col">${concepts.join("")}</div><div class="vs-mid" aria-hidden="true">VS</div><div class="vs-col">${result}</div>`
      : '<p class="empty">No concept art recorded for this game.</p>';
    $("#concept").hidden = !(concepts.length || result);

    // assets
    const art = (a.stages?.art?.report) || {};
    const secs = (k) => (art[k]?.seconds ? `<span class="took">${fmtS(art[k].seconds)} on the GPU</span>` : "");
    const by = (kind) => Object.entries(assets).filter(([, v]) => v.kind === kind);
    const html = [];
    for (const [k, v] of by("sky")) {
      html.push(`<div class="asset sky"><div class="sky-strip" style="background-image:url('${esc(url("assets/" + v.file))}')"></div>
        <div class="cap"><span class="chip sky">Sky${v.projection ? ` · ${esc(v.projection)}` : ""}</span><p>“${esc(v.prompt)}”</p>${secs(k)}</div></div>`);
    }
    const tiles = [];
    for (const [k, v] of by("icon")) tiles.push(`<div class="asset tile"><div class="pic checker"><img src="${esc(url("assets/" + v.file))}" alt="" loading="lazy"></div>
      <div class="cap"><span class="chip sun">Icon${v.for ? ` · ${esc(v.for)}` : ""}</span><p>“${esc(v.prompt)}”</p>${secs(k)}</div></div>`);
    for (const [k, v] of by("prop")) tiles.push(`<div class="asset tile"><div class="pic checker"><img src="${esc(url(`about/${k}_preview.png`))}" alt="" loading="lazy" onerror="this.parentNode.classList.add('noimg')"><span class="pname">${esc(title(k.replace(/^prop_/, "")))}</span></div>
      <div class="cap"><span class="chip grass">Prop${v.via ? ` · ${esc(v.via)}` : ""}${v.parts ? ` · ${nf.format(v.parts)} voxels` : ""}</span><p>“${esc(v.prompt)}”</p>${secs(k)}</div></div>`);
    if (tiles.length) html.push(`<div class="tiles">${tiles.join("")}</div>`);
    const sounds = [...by("music"), ...by("sfx")];
    if (sounds.length) html.push(`<div class="sounds">${sounds.map(([k, v]) => `<div class="sound">
      <button class="playbtn" data-src="${esc(url("assets/" + v.file))}" aria-label="Play ${esc(k)}"><i></i></button>
      <div class="cap"><span class="chip ${v.kind === "music" ? "pink" : "sky"}">${v.kind === "music" ? "Music · ACE-Step" : `Sound · ${esc(v.event || k)}`}</span>
      <p>“${esc(v.prompt)}”</p><div class="bar"><span></span></div>${secs(k)}</div></div>`).join("")}</div>`);
    $("#g-assets").innerHTML = html.join("") || '<p class="empty">No generated assets recorded.</p>';
    wireAudio();

    // build log
    $("#g-log").innerHTML = [timeline(t), scores(a.score), builderReport(a.stages?.build),
      callsTable(a.model_calls, a.agents)].filter(Boolean).join("");
  }

  // stage order: plan, art, scaffold, build, then eval/repair rounds in the order they ran
  function stageKey(k) {
    const fixed = ["plan", "art", "scaffold", "build"].indexOf(k);
    if (fixed >= 0) return [fixed, 0, 0];
    let m = /^eval_s(\d+)$/.exec(k); if (m) return [4, -1, 1];
    m = /^eval_v(\d+)$/.exec(k); if (m) return [4, +m[1], 1];
    m = /^repair_(\d+)$/.exec(k); if (m) return [4, +m[1], 0];
    return [9, 0, 0];
  }
  const cmp = (x, y) => { const a = stageKey(x), b = stageKey(y); return a[0] - b[0] || a[1] - b[1] || a[2] - b[2]; };
  function stageLabel(k) {
    const L = { plan: ["Plan", "Qwen3.8-27B designs the game"], art: ["Art", "ComfyUI: concept board + assets"],
      scaffold: ["Scaffold", "a working baseline from the plan"], build: ["Build", "builder agent writes the game"] };
    if (L[k]) return L[k];
    let m = /^eval_s\d+$/.exec(k); if (m) return ["Judge scaffold", "bot playtest + vision score"];
    m = /^eval_v(\d+)$/.exec(k); if (m) return [`Judge v${m[1]}`, "bot playtest + vision score"];
    m = /^repair_(\d+)$/.exec(k); if (m) return [`Repair ${m[1]}`, "fixes the judge's findings"];
    return [k, ""];
  }
  function timeline(t) {
    const ks = Object.keys(t || {}).sort(cmp);
    if (!ks.length) return "";
    const max = Math.max(...ks.map((k) => t[k]));
    const total = ks.reduce((n, k) => n + t[k], 0);
    return `<div class="panel tl"><h3>Build timeline <small>${fmtS(total)} total</small></h3><div class="bars">${ks.map((k) => {
      const [name, sub] = stageLabel(k);
      const kind = k.startsWith("repair") ? "rep" : k.startsWith("eval") ? "eval" : k === "art" ? "art" : "llm";
      return `<div class="brow" data-tip="${esc(name)}: ${t[k].toFixed(1)} s"><span class="bl">${esc(name)}<small>${esc(sub)}</small></span>
        <span class="bt"><span class="bf ${kind}" style="width:${Math.max(0.6, (t[k] / max) * 100).toFixed(2)}%"></span></span><span class="bv">${fmtS(t[k])}</span></div>`;
    }).join("")}</div></div>`;
  }
  function verLabel(tag) {
    if (/^s\d+$/.test(tag)) return "Scaffold";
    const m = /^v(\d+)$/.exec(tag);
    if (!m) return tag;
    return +m[1] === 0 ? "First build" : `After repair ${m[1]}`;
  }
  function scores(sc) {
    const vs = (sc?.versions || []).slice().sort((x, y) => cmp(`eval_${x.tag}`, `eval_${y.tag}`));
    if (!vs.length) return "";
    return `<div class="panel"><h3>Judge score per version <small>out of 10 · best is kept</small></h3><div class="bars">${vs.map((v) => {
      const best = v.tag === sc.best;
      return `<div class="brow${best ? " best" : ""}" data-tip="${esc(verLabel(v.tag))}: score ${v.score} (play ${v.play_score}, vision ${v.vision_score})">
        <span class="bl">${esc(verLabel(v.tag))}<small>play ${esc(v.play_score)} · vision ${esc(v.vision_score)}</small></span>
        <span class="bt"><span class="bf ${best ? "best" : "llm"}" style="width:${Math.max(0.6, (v.score / 10) * 100).toFixed(2)}%"></span></span>
        <span class="bv">${esc(v.score)}${best ? ' <em class="kept">KEPT</em>' : ""}</span></div>`;
    }).join("")}</div></div>`;
  }
  function builderReport(b) {
    const r = b?.result;
    if (!r || (!r.summary && !r.changes?.length)) return "";
    const list = (xs) => `<ul>${xs.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>`;
    return `<div class="panel report"><h3>The builder's own report <small>verbatim${b.plays ? ` · played its game ${esc(b.plays)} time${b.plays > 1 ? "s" : ""} while building` : ""}</small></h3>
      ${r.summary ? `<p class="sum">${esc(r.summary)}</p>` : ""}
      <div class="cols">${r.changes?.length ? `<div><h4>What it changed</h4>${list(r.changes)}</div>` : ""}
      ${r.known_issues?.length ? `<div><h4>Known issues it reported</h4>${list(r.known_issues)}</div>` : ""}</div></div>`;
  }
  function callsTable(mc, agents) {
    const roles = Object.entries(mc || {});
    if (!roles.length) return "";
    const names = { lead: "Lead designer", builder: "Builder", judge: "Vision judge" };
    const sum = (f) => roles.reduce((n, [, r]) => n + (r[f] || 0), 0);
    const row = (n, c, p, o) => `<tr><td>${n}</td><td>${nf.format(c)}</td><td>${nf.format(p)}</td><td>${nf.format(o)}</td></tr>`;
    return `<div class="panel wide"><h3>Model calls <small>all to Qwen3.8-27B, running locally</small></h3>
      <table class="calls"><thead><tr><th>Role</th><th>Calls</th><th>Tokens read</th><th>Tokens written</th></tr></thead><tbody>
      ${roles.map(([k, r]) => row(esc(names[k] || title(k)), r.calls || 0, r.prompt_tokens || 0, r.completion_tokens || 0)).join("")}
      </tbody><tfoot>${row("Total", sum("calls"), sum("prompt_tokens"), sum("completion_tokens"))}</tfoot></table>
      ${agents ? `<p class="mk-note">${nf.format(agents.live || 0)} agent runs${agents.failed ? `, ${agents.failed} failed` : ""}.</p>` : ""}</div>`;
  }

  function wireAudio() {
    let cur = null, btn = null;
    document.querySelectorAll(".playbtn").forEach((b) => b.addEventListener("click", () => {
      if (btn === b && cur && !cur.paused) { cur.pause(); return; }
      if (cur) { cur.pause(); btn.classList.remove("on"); }
      cur = new Audio(b.dataset.src);
      btn = b;
      const bar = b.parentNode.querySelector(".bar span");
      cur.addEventListener("timeupdate", () => { if (cur.duration) bar.style.width = `${(cur.currentTime / cur.duration) * 100}%`; });
      cur.addEventListener("pause", () => b.classList.remove("on"));
      cur.addEventListener("ended", () => { b.classList.remove("on"); bar.style.width = "0"; });
      cur.play().then(() => b.classList.add("on")).catch(() => {});
    }));
  }
})();
