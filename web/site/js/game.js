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

  Promise.all([getJSON(base + "about.json"), getJSON(base + "assets/assets.json"), getJSON("../games/index.json")])
    .then(([a, assets, idx]) => {
      if (!a) return fail(`No record for "${id}".`);
      // the index's controls are checked against the kit and game code (lines naming an unbound key are dropped)
      const entry = ((idx && idx.games) || []).find((g) => g.id === id);
      if (entry && Array.isArray(entry.controls)) a = { ...a, controls: entry.controls };
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
    const chosenLevel = a.mapping?.chosen?.level_kind;
    const mechs = Array.isArray(a.mechanics) ? a.mechanics : [];
    const lay = a.mapping?.layout;
    const laidOut = chosenLevel === "custom" && laidOutBy(lay);
    const startLayout = a.mapping?.chosen?.custom_layout || plan.custom_layout;
    if (chosenLevel === "custom") facts.push(laidOut ? '<a class="chip sun" href="#beyond">Level laid out by the model</a>'
      : `<a class="chip" href="#beyond">Composed level${startLayout ? ` (from '${esc(startLayout)}')` : ""}</a>`);
    const own = mechs.filter((m) => m && (m.how === "custom" || m.how === "rule")).length;
    if (mechs.length) facts.push(own ? `<a class="chip pink" href="#beyond">Custom mechanics: ${own}</a>`
      : `<a class="chip" href="#beyond">Kit mechanics: ${mechs.length}</a>`);
    if (a.dry_run) facts.push('<span class="chip ink">DEV: dry run, fake models</span>');
    $("#g-facts").innerHTML = facts.join("");
    const ctrls = a.controls || plan.controls || [];
    $("#g-controls").innerHTML = ctrls.map((c) => {
      const [k, v] = String(c).split(/:\s*/, 2);
      return v ? `<span><kbd>${esc(k)}</kbd> ${esc(v)}</span>` : `<span>${esc(c)}</span>`;
    }).join("");

    $("#g-howto").innerHTML = howTo(a.mapping?.chosen?.player_type || plan.player_type, ctrls.length > 0, a.play || "index.html");

    // hero media
    const scr = $("#g-screen");
    if (a.video) {
      scr.innerHTML = `<video src="${esc(url(a.video))}" ${a.thumbnail ? `poster="${esc(url(a.thumbnail))}"` : ""} muted loop autoplay playsinline></video>
        <span class="chip ink tag">Autopilot gameplay, recorded by the pipeline</span>`;
    } else if (a.thumbnail) {
      scr.innerHTML = `<img src="${esc(url(a.thumbnail))}" alt="">`;
    }

    // pitch, and any human hand on the game after it (about.json "operator_interventions"; absent = none recorded)
    $("#g-pitch").textContent = a.pitch || "";
    let ops = a.operator_interventions ?? [];
    if (typeof ops === "string") ops = ops.trim() ? [ops] : [];
    $("#g-ops").innerHTML = ops.length
      ? `<b>Operator interventions: ${ops.length}.</b> Besides the pitch, a person changed this game:<ul>${ops.map((o) => `<li>${esc(typeof o === "string" ? o : JSON.stringify(o))}</li>`).join("")}</ul>`
      : "<b>Operator interventions: none recorded.</b> This paragraph is the only human input. Everything below was made from it by local, open-weight models.";
    if (ops.length) $("#g-facts").insertAdjacentHTML("beforeend", `<span class="chip ink">${ops.length} operator intervention${ops.length > 1 ? "s" : ""}</span>`);

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
    $("#g-map").innerHTML = mappingBlock(a.mapping);
    renderBeyond(a, chosenLevel, mechs, laidOut, startLayout);

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
    // report seconds count from the start of the art burst, so they are a finish time, not a per-asset cost
    const secs = (k) => (art[k]?.ok && art[k].seconds ? `<span class="took">ready ${fmtS(art[k].seconds)} into the art burst</span>` : "");
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
    for (const [k, v] of by("splat")) tiles.push(`<div class="asset tile"><div class="pic checker"><img src="${esc(url(`about/${k}_preview.png`))}" alt="" loading="lazy" onerror="this.parentNode.classList.add('noimg')"><span class="pname">${esc(title(k.replace(/^splat_/, "")))}</span></div>
      <div class="cap"><span class="chip pink">Gaussian splat · Idol</span>${v.prompt ? `<p>“${esc(v.prompt)}”</p>` : ""}${secs(k)}</div></div>`);
        if (tiles.length) html.push(`<div class="tiles">${tiles.join("")}</div>`);
    const cuts = by("cutscene");
    if (cuts.length) {
      const order = { intro: 0, win: 1, lose: 2 };
      cuts.sort(([, x], [, y]) => (order[x.when] ?? 9) - (order[y.when] ?? 9));
      const stageModel = cutsceneModel(a.post_stages);
      html.push(`<h3 class="asset-h">Cutscenes</h3><div class="cuts">${cuts.map(([k, v]) => `<figure class="asset cut">
        <video src="${esc(url("assets/" + v.file))}" ${v.source ? `poster="${esc(url("assets/" + v.source))}"` : ""} controls muted playsinline preload="metadata"></video>
        <figcaption class="cap"><span class="chip ink">Cutscene · ${esc(v.model || stageModel)}${v.when ? ` · ${esc(v.when)}` : ""}</span>
        ${v.prompt ? `<p title="${esc(v.prompt)}">“${esc(v.prompt)}”</p>` : ""}</figcaption></figure>`).join("")}</div>`);
    }
    const post = postStagesLine(a.post_stages);
    if (post) html.push(`<p class="post-line">${post}</p>`);
    const sounds = [...by("music"), ...by("sfx")];
    if (sounds.length) html.push(`<div class="sounds">${sounds.map(([k, v]) => `<div class="sound">
      <button class="playbtn" data-src="${esc(url("assets/" + v.file))}" aria-label="Play ${esc(k)}"><i></i></button>
      <div class="cap"><span class="chip ${v.kind === "music" ? "pink" : "sky"}">${v.kind === "music" ? "Music · ACE-Step" : `Sound · ${esc(v.event || k)}`}</span>
      <p>“${esc(v.prompt)}”</p><div class="bar"><span></span></div>${secs(k)}</div></div>`).join("")}</div>`);
    // jobs the plan asked for that ComfyUI did not deliver: say so rather than imply every asset was made
    const failedE = Object.entries(art).filter(([, v]) => v && v.ok === false);
    const failed = failedE.map(([k]) => k);
    const reasons = [...new Set(failedE.map(([, v]) => v.reason).filter(Boolean))];
    if (failed.length) {
      const groups = {};
      for (const k of failed) {
        const [kind, ...rest] = k.split("_");
        (groups[kind] ||= []).push(rest.join(" ") || kind);
      }
      const noun = { sfx: "sound effect", prop: "prop", icon: "icon", music: "music track", sky: "sky" };
      html.push(`<p class="failed"><b>Requested but not made:</b> ${Object.entries(groups).map(([kind, names]) =>
        `${names.length} ${esc(noun[kind] || kind)}${names.length > 1 ? "s" : ""} (${names.map(esc).join(", ")})`).join("; ")}.
        These ComfyUI jobs failed, so they are not among this game's generated assets.
        ${reasons.length ? `<span class="why">Reported reason${reasons.length > 1 ? "s" : ""}: ${reasons.map((r) => `<code>${esc(r)}</code>`).join(" ")}</span>` : ""}</p>`);
    }
    $("#g-assets").innerHTML = html.join("") || '<p class="empty">No generated assets recorded.</p>';
    wireAudio();

    // build log
    $("#g-log").innerHTML = [timeline(t), scores(a.score), postStages(a.post_stages), callsTable(a.model_calls, a.agents),
      builderReport(a.stages?.build)].filter(Boolean).join("");
  }

  // post_stages: a list (["cutscenes"]) or a dict ({cutscenes: {model: "LTX-2.5"}}); LTX-2.5 unless a model is recorded
  // blocksfield/web_cutscenes.py appends {"stage": "cutscenes", "model", "run", "clips": [...], "at"} to post_stages
  function cutsceneStage(ps) {
    return (Array.isArray(ps) ? ps : []).find((x) => x && typeof x === "object" && x.stage === "cutscenes") || null;
  }
  function cutsceneModel(ps) {
    const c = cutsceneStage(ps);
    return (c && c.model) || "LTX-2.5";
  }
  // post_stages entries written by web_run ({stage, kit_commit, at}): uniform passes run after every build
  function postStages(ps) {
    const items = (Array.isArray(ps) ? ps : []).filter((x) => x && typeof x === "object" && x.stage);
    if (!items.length) return "";
    const text = (x) => x.stage === "cutscenes"
      ? `Cutscenes generated by ${esc(x.model || "LTX-2.5")}${Array.isArray(x.clips) && x.clips.length ? ` (${x.clips.map(esc).join(", ")})` : ""}, ${esc(x.run || "uniform pipeline stage after build")}`
      : esc(x.stage);
    return `<div class="panel wide"><h3>After the build <small>the same passes for every game</small></h3><ul class="post-list">${items.map((x) =>
      `<li>${text(x)}${x.kit_commit ? ` <code>kit ${esc(String(x.kit_commit).slice(0, 10))}</code>` : ""}${x.at ? ` <span>${esc(x.at)}</span>` : ""}</li>`).join("")}</ul></div>`;
  }
  function postStagesLine(ps) {
    const c = cutsceneStage(ps);
    return c ? `Cutscenes generated by ${esc(c.model || "LTX-2.5")} in a uniform post-build stage.` : "";
  }

  // "Beyond the kits": a model-laid level (mapping.layout, verbatim) and custom mechanics with their code
  // same rule as build_index.level_laid_out: evidence in mapping.layout, or no strong claim
  function laidOutBy(lay) {
    if (!lay || typeof lay !== "object") return false;
    return lay.start === "freeform" || Number(lay.pieces_changed_from_start || 0) > 0;
  }
  function renderBeyond(a, level, mechs, laidOut, startLayout) {
    const parts = [];
    if (level === "custom") {
      const lay = a.mapping?.layout;
      const rows = lay && typeof lay === "object"
        ? Object.entries(lay).map(([k, v]) => `<tr><th>${esc(k)}</th><td>${esc(typeof v === "object" ? JSON.stringify(v) : v)}</td></tr>`).join("")
        : "";
      parts.push(laidOut
        ? `<div class="beyond-card"><h3><span class="chip sun">Level laid out by the model</span></h3>
          <p>Instead of a one-call kit level, the model placed this level's pieces itself.</p>
          ${rows ? `<table class="layout-tbl">${rows}</table>` : ""}</div>`
        : `<div class="beyond-card"><h3><span class="chip">Composed level (Level.compose)</span></h3>
          <p>${startLayout ? `From the '${esc(startLayout)}' starting layout.` : "Built with Level.compose."}</p></div>`);
    }
    if (mechs.length) {
      const anyOwn = mechs.some((m) => m && (m.how === "custom" || m.how === "rule"));
      parts.push(`<div class="beyond-card"><h3><span class="chip ${anyOwn ? "pink" : ""}">${anyOwn ? "Mechanics" : "Kit mechanics"}</span></h3><div class="mechs">${mechs.map((m, i) => {
        const o = typeof m === "object" && m ? m : { name: String(m) };
        const how = o.how || o.implementation || o.kind;
        return `<div class="mech"><div class="mech-head"><b>${esc(o.name || `mechanic ${i + 1}`)}</b>${how ? `<span class="how how-${esc(how)}">${esc(how)}</span>` : ""}${o.api ? `<code class="api">${esc(o.api)}</code>` : ""}${o.line_start ? `<span class="where">${esc(o.file || "game.js")}:${esc(o.line_start)}</span>` : ""}</div>
          ${o.description ? `<p>${esc(o.description)}</p>` : ""}<pre class="snip" data-i="${i}" hidden><code></code></pre></div>`;
      }).join("")}</div></div>`);
    }
    if (!parts.length) return;
    $("#g-beyond").innerHTML = parts.join("");
    $("#beyond").hidden = false;
    mechs.forEach((m, i) => snippet(m).then((code) => {
      if (!code) return;
      const pre = document.querySelector(`.snip[data-i="${i}"]`);
      pre.querySelector("code").textContent = code;
      pre.hidden = false;
    }));
  }
  // a mechanic's code: inline (snippet / code), a line range (lines [a, b] or line_start / line_end, 1-based) or an
  // anchor string, in game.js unless the record names another file of the game
  function snippet(m) {
    if (!m || typeof m !== "object") return Promise.resolve("");
    if (typeof m.snippet === "string" && m.snippet.trim()) return Promise.resolve(m.snippet);
    if (typeof m.code === "string" && m.code.trim()) return Promise.resolve(m.code);
    const range = Array.isArray(m.lines) ? m.lines : (m.line_start ? [m.line_start, m.line_end || m.line_start] : null);
    if (!range && !m.anchor) return Promise.resolve("");
    return fetch(url(m.file || "game.js")).then((r) => (r.ok ? r.text() : "")).then((src) => {
      const lines = src.split("\n");
      if (range) return lines.slice(Math.max(0, range[0] - 1), Math.min(lines.length, range[1])).join("\n");
      const at = lines.findIndex((l) => l.includes(m.anchor));
      return at < 0 ? "" : lines.slice(at, at + 24).join("\n");
    }).catch(() => "");
  }

  // How to play: the kit's real bindings (web/kit/docs/Player.md, touch.js) per player type. The game's own controls
  // list (shown in the header) wins for the keyboard; the kit line is the fallback when a game has none.
  const HOWTO = {
    platformer: ["WASD / arrows run · Space jump (again in the air: double jump, hold: higher) · Shift dash (long jump when running) · C ground pound · drag the mouse to turn the camera",
      "left stick move · JUMP / DASH buttons · drag the right side to turn the camera"],
    kart: ["W / ↑ throttle · S / ↓ brake and reverse · A D / ← → steer · hold Space while steering to drift, release to boost",
      "left stick steer and throttle · hold DRIFT in a turn, release to boost"],
    topdown: ["WASD / arrows move · Shift / E dash · Space jump (in blaster games Space / J / click fire)",
      "left stick move · DASH / JUMP buttons"],
    fps: ["WASD move · mouse look (click to lock the pointer) · click / E shoot · Space jump · Shift sprint",
      "left stick move · drag the right side to look · FIRE / JUMP buttons"],
  };
  HOWTO.boat = HOWTO.kart;
  // gamepad, per type, from the kit's readKeys (A = button 0 jump, X / RB / RT = action, B / LT = pound) and the
  // vehicle drift input (jump or action); the right stick turns the orbit/follow camera, not the vehicles' chase cam
  const PAD = {
    platformer: "left stick move · A jump · X / RB dash · B ground pound · right stick camera",
    kart: "left stick steer (push up to accelerate, down to brake) · hold A, X, RB or RT in a turn to drift, release to boost",
    topdown: "left stick move · A jump (fire in blaster games) · X / RB dash",
    fps: "left stick move · A jump and fire · X / RB action",
  };
  PAD.boat = PAD.kart;
  function howTo(type, hasControls, play) {
    const h = HOWTO[type];
    if (!h) return "";
    const rows = [];
    if (!hasControls) rows.push(["Keyboard", h[0]]);
    rows.push(["Phone", h[1]]);
    rows.push(["Gamepad", PAD[type] || PAD.platformer]);
    rows.push(["Pause / reset", "Esc / P pause · R puts you back on the route"]);
    return `<h3>How to play</h3><dl>${rows.map(([k, v]) => `<div><dt>${k}</dt><dd>${esc(v)}</dd></div>`).join("")}</dl>
      <p class="howto-foot">Phones: play in landscape. Weak laptop? Open <a href="${esc(url(play))}?quality=low">the low-quality version</a>.</p>`;
  }

  // about.json "mapping": how the pitch became kit choices (notes is null on games planned before 21:00)
  function mappingBlock(m) {
    const ch = m && m.chosen;
    if (!ch) return "";
    const L = { level_kind: "Level", look: "Look", player_type: "Player", camera: "Camera", ui_style: "HUD style",
      collectible: "Pickup", collectible_label: "Pickup name", character: "Character" };
    const show = (v) => (v && typeof v === "object"
      ? Object.entries(v).map(([k, x]) => `${esc(k)}: ${esc(Array.isArray(x) ? x.join(", ") : x)}`).join(" · ") : esc(v));
    const chips = Object.entries(ch).filter(([, v]) => v !== null && v !== undefined && v !== "")
      .map(([k, v]) => `<div class="mchoice"><span>${esc(L[k] || title(k))}</span><code>${show(v)}</code></div>`).join("");
    let notes = "";
    const n = m.notes;
    if (typeof n === "string" && n.trim()) notes = `<p class="mnotes">${esc(n)}</p>`;
    else if (Array.isArray(n) && n.length) notes = `<ul class="mnotes">${n.map((x) => `<li>${esc(typeof x === "string" ? x : JSON.stringify(x))}</li>`).join("")}</ul>`;
    else if (n && typeof n === "object") notes = `<ul class="mnotes">${Object.entries(n).map(([k, x]) => `<li><b>${esc(L[k] || title(k))}:</b> ${esc(x)}</li>`).join("")}</ul>`;
    // builder_overrides: where the builder changed the plan's choice in the shipped game.js
    const bo = m.builder_overrides;
    let over = "";
    if (typeof bo === "string" && bo.trim()) over = esc(bo);
    else if (Array.isArray(bo) && bo.length) over = bo.map((x) => esc(typeof x === "string" ? x : JSON.stringify(x))).join(" · ");
    else if (bo && typeof bo === "object" && Object.keys(bo).length) over = Object.entries(bo).map(([k, x]) =>
      `<b>${esc(L[k] || title(k))}:</b> ${esc(typeof x === "string" ? x : JSON.stringify(x))}`).join(" · ");
    if (over) over = `<p class="moverride"><b>Builder changes:</b> ${over.replace(/^the /, "The ")}</p>`;
    return `<div class="mapping"><h3>From pitch to kit choices</h3><div class="mchoices">${chips}</div>${over}${notes}</div>`;
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
    return `<div class="panel wide report"><h3>The builder's own report <small>verbatim${b.plays ? ` · played its game ${esc(b.plays)} time${b.plays > 1 ? "s" : ""} while building` : ""}</small></h3>
      ${r.summary ? (r.summary.length > 360
        ? `<details class="sum"><summary>${esc(r.summary.slice(0, 340).replace(/\s+\S*$/, ""))}… <b>Read the whole summary</b></summary><p>${esc(r.summary)}</p></details>`
        : `<p class="sum">${esc(r.summary)}</p>`) : ""}
      <div class="cols">${r.changes?.length ? `<div><h4>What it changed</h4>${list(r.changes)}</div>` : ""}
      ${r.known_issues?.length ? `<div><h4>Known issues it reported</h4>${list(r.known_issues)}</div>` : ""}</div></div>`;
  }
  function callsTable(mc, agents) {
    const roles = Object.entries(mc || {});
    if (!roles.length) return "";
    const names = { lead: "Lead designer", builder: "Builder", judge: "Vision judge" };
    const sum = (f) => roles.reduce((n, [, r]) => n + (r[f] || 0), 0);
    const row = (n, c, p, o) => `<tr><td>${n}</td><td>${nf.format(c)}</td><td>${nf.format(p)}</td><td>${nf.format(o)}</td></tr>`;
    return `<div class="panel"><h3>Model calls <small>all to Qwen3.8-27B, running locally</small></h3>
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
