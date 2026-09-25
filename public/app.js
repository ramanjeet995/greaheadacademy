// Gearhead Academy — browser app. Talks to the Worker API for accounts, progress sync and the AI mentor.
const LEVELS = [
  { name: "Student", color: "var(--l1)" },
  { name: "Junior", color: "var(--l2)" },
  { name: "Mid-level", color: "var(--l3)" },
  { name: "Senior", color: "var(--l4)" },
  { name: "Modern", color: "var(--l5)" },
];
const FIELDS = [
  { id: "mechanical", name: "Mechanical" },
  { id: "electromechanical", name: "Electromechanical" },
];
const LAYER_BLURBS = [
  "The basic idea — the parts and how they connect",
  "The core mechanism — which one, and how it moves",
  "Refinement — geometry, feel, and what goes wrong",
  "Assistance and safety — making it work in the real world",
  "Modern designs — what engineers build today",
];

let SYSTEMS = [];
let busy = false;
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const lvl = (i) => LEVELS[Math.min(i, LEVELS.length - 1)];

// ---------------------------------------------------------------- local state (per browser)
function readLS(k, dflt) { try { return JSON.parse(localStorage.getItem(k)) ?? dflt; } catch { return dflt; } }
function writeLS(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} }
const state = Object.assign({ field: "mechanical", sessions: {}, aiOn: true }, readLS("ga-state", {}));
let auth = readLS("ga-auth", null); // {token, username, remaining}
let freeDaily = 5;

let syncTimer;
function save() {
  writeLS("ga-state", state);
  if (!auth) return;
  clearTimeout(syncTimer);
  syncTimer = setTimeout(pushProgress, 1500);
}
async function pushProgress() {
  if (!auth) return;
  try { await api("/api/progress", { method: "PUT", body: JSON.stringify({ sessions: state.sessions }) }); } catch {}
}

// ---------------------------------------------------------------- API
async function api(path, opts = {}) {
  const headers = { "content-type": "application/json" };
  if (auth?.token) headers.authorization = `Bearer ${auth.token}`;
  const res = await fetch(path, { ...opts, headers });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && auth && path !== "/api/login") {
    auth = null; writeLS("ga-auth", null); renderAccount();
  }
  if (!res.ok) throw Object.assign(new Error(data.message || "Request failed"), { status: res.status, data });
  return data;
}

// ---------------------------------------------------------------- routing
const byId = (id) => SYSTEMS.find((s) => s.id === id);
const systemsOf = () => SYSTEMS.filter((s) => s.field === state.field);
function currentView() {
  const m = location.pathname.match(/^\/s\/([a-z0-9-]+)\/?$/);
  if (m && byId(m[1])) { state.field = byId(m[1]).field; return { type: "sys", id: m[1] }; }
  return { type: "home" };
}
function go(v) {
  const path = v.type === "sys" ? `/s/${v.id}` : "/";
  if (location.pathname !== path) history.pushState(null, "", path);
  renderAll(true);
}
window.addEventListener("popstate", () => renderAll(false));
document.addEventListener("click", (e) => {
  const a = e.target.closest("a[data-nav]");
  if (!a || e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
  e.preventDefault();
  go(a.dataset.nav === "home" ? { type: "home" } : { type: "sys", id: a.dataset.nav });
});

// ---------------------------------------------------------------- sessions
function session(sys) { return (state.sessions[sys.id] ||= { layer: 0, turns: 0, hintIdx: 0, thread: [{ type: "problem" }], done: false, draft: "" }); }
function reached(sys) { const s = state.sessions[sys.id]; return !s ? 0 : s.done ? sys.layers.length : s.layer; }
const askFor = (sys, i) => (i === 0 ? sys.prompt : sys.layers[i].ask);
const dots = (sys) => `<span class="dots" aria-label="${reached(sys)} of ${sys.layers.length} layers">${sys.layers.map((_, i) => `<i class="${i < reached(sys) ? "on" : ""}" style="--c:${lvl(i).color}"></i>`).join("")}</span>`;

// ---------------------------------------------------------------- chrome
function renderAll(scroll) {
  const v = currentView();
  renderFields(); renderAccount(); renderPath(v); renderMain(v); renderNotes(v);
  const sys = v.type === "sys" ? byId(v.id) : null;
  document.title = sys ? `How a ${sys.title} works — Gearhead Academy` : "Gearhead Academy — learn how machines work by designing them";
  if (scroll) $("sheet").scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "start" });
}
function renderFields() {
  $("fields").innerHTML = `<span class="lbl">Field</span>` + FIELDS.map((f) => `<button class="field" data-f="${f.id}" aria-pressed="${f.id === state.field}">${f.name}</button>`).join("");
  $("fields").querySelectorAll(".field").forEach((b) => (b.onclick = () => { state.field = b.dataset.f; save(); go({ type: "home" }); }));
}
function renderAccount() {
  const box = $("account");
  if (auth) {
    box.innerHTML = `<div>Signed in as <span class="who">${esc(auth.username)}</span></div>
      <label class="toggle"><input type="checkbox" id="aiToggle" ${state.aiOn ? "checked" : ""}> Use the AI mentor</label>
      <div class="note">AI replies left today: <b>${auth.remaining ?? "–"}</b> of ${freeDaily}. Without the AI mentor you still get the real-world answer after each layer.</div>
      <button class="link" id="logoutBtn" style="justify-self:start">Sign out</button>`;
    $("aiToggle").onchange = (e) => { state.aiOn = e.target.checked; save(); };
    $("logoutBtn").onclick = async () => { try { await api("/api/logout", { method: "POST" }); } catch {} auth = null; writeLS("ga-auth", null); renderAccount(); };
  } else {
    box.innerHTML = `<form id="loginForm">
      <div class="note"><b>Save your progress</b> and unlock ${freeDaily} AI mentor replies a day. Pick any username and a PIN — new usernames are created automatically.</div>
      <input type="text" id="uName" placeholder="username" autocomplete="username" maxlength="20" required>
      <div class="row"><input type="password" id="uPin" placeholder="PIN (4–8 digits)" inputmode="numeric" autocomplete="current-password" maxlength="8" required>
      <button class="btn" type="submit">Go</button></div>
      <span class="note" id="loginMsg">There's no PIN recovery — keep it somewhere safe.</span></form>`;
    $("loginForm").onsubmit = (e) => { e.preventDefault(); login(); };
  }
}
async function login() {
  const msg = $("loginMsg");
  msg.textContent = "Signing in…";
  try {
    const r = await api("/api/login", { method: "POST", body: JSON.stringify({ username: $("uName").value, pin: $("uPin").value }) });
    auth = { token: r.token, username: r.username, remaining: r.remaining };
    writeLS("ga-auth", auth);
    const p = await api("/api/progress");
    mergeProgress(p.data?.sessions || {});
    save(); await pushProgress();
    renderAll(false);
  } catch (e) { msg.textContent = e.data?.message || "Couldn't sign in. Check your connection and try again."; }
}
// Keep whichever copy of each system has gone further.
function mergeProgress(server) {
  const score = (s) => (s ? (s.done ? 1000 : 0) + s.layer * 50 + (s.thread?.length || 0) : -1);
  for (const [id, s] of Object.entries(server)) if (score(s) > score(state.sessions[id])) state.sessions[id] = s;
}
function renderPath(v) {
  const list = systemsOf();
  $("path").innerHTML = `<h2>${esc(FIELDS.find((f) => f.id === state.field).name)} systems</h2><ol class="syslist">` +
    list.map((s) => `<li><a class="sysbtn" href="/s/${s.id}" data-nav="${s.id}" ${v.type === "sys" && v.id === s.id ? `aria-current="page"` : ""}>
      <span>${esc(s.title)}</span><span class="era">${esc(s.era || "")}</span>${dots(s)}</a></li>`).join("") + `</ol>`;
  const done = list.filter((s) => state.sessions[s.id]?.done).length;
  $("doneCount").textContent = `${done}/${list.length}`;
  $("doneBar").style.width = (list.length ? (done / list.length) * 100 : 0) + "%";
}
function renderMain(v) { v.type === "home" ? renderHome() : renderSession(byId(v.id)); }
function renderNotes(v) {
  const sys = v.type === "sys" ? byId(v.id) : null;
  if (!sys) {
    if ($("notes").dataset.client) $("notes").innerHTML = homeNotes();
    return;
  }
  $("notes").dataset.client = "1";
  $("notes").innerHTML = `<h2>How does a ${esc(sys.title.toLowerCase())} work?</h2><p>${esc(sys.prompt)}</p>
    <details><summary>Reference notes: how real designs do it (spoilers)</summary>
    ${sys.layers.map((l, i) => `<h4>Layer ${i + 1} · ${esc(l.name)}</h4><p>${esc(l.real)}</p>`).join("")}</details>`;
}
function homeNotes() {
  return `<h2>What is Gearhead Academy?</h2><p>Pick a machine and you're asked how you would make it work. You answer in plain words, compare your idea with real designs, then go one layer deeper — from the basic idea to what engineers build today.</p>
    <h3>All systems</h3><ul class="links">${SYSTEMS.map((s) => `<li><a href="/s/${s.id}" data-nav="${s.id}">How a ${esc(s.title.toLowerCase())} works</a></li>`).join("")}</ul>`;
}

// ---------------------------------------------------------------- home
function renderHome() {
  const list = systemsOf();
  $("sheet").innerHTML = `
    <p class="eyebrow">${esc(FIELDS.find((f) => f.id === state.field).name)} engineering</p>
    <h3 class="ptitle">Pick a system to design</h3>
    <p class="intro">You'll be asked how you would make it work. Answer in plain words — parts, how they connect, how they move, why you'd choose them. No calculations. You'll see how your method compares with real designs, then go one layer deeper, following the mechanism you chose.</p>
    <ol class="ladder">${LEVELS.map((l, i) => `<li style="--c:${l.color}"><span class="lvl">Layer ${i + 1} · ${l.name}</span><span>${LAYER_BLURBS[i]}</span></li>`).join("")}</ol>
    <h4 class="sec">Systems</h4>
    <div class="cards">${list.map((s) => {
      const st = state.sessions[s.id];
      return `<div class="card"><div class="row"><span class="era">${esc(s.era || "")}</span>${dots(s)}</div>
        <h5>${esc(s.title)}</h5><p>${esc(s.prompt.split(". ")[0])}.</p>
        <div class="row"><span class="note">${st?.done ? "Completed" : st ? `On layer ${reached(s) + 1} of ${s.layers.length}` : `${s.layers.length} layers`}</span>
        <a class="btn ${st && !st.done ? "primary" : ""}" href="/s/${s.id}" data-nav="${s.id}">${st?.done ? "Review" : st ? "Continue" : "Start"}</a></div></div>`;
    }).join("")}</div>`;
}

// ---------------------------------------------------------------- guided session
function renderEntry(sys, e) {
  if (e.type === "problem") return `<div class="msg mentor"><div class="who">Mentor · Layer 1 · ${lvl(0).name}</div><div class="body"><p>${esc(sys.prompt)}</p><p class="note">No calculations needed — describe the parts, how they connect and move, and why.</p></div></div>`;
  if (e.type === "answer") return `<div class="msg you"><div class="who">You · Layer ${e.layer + 1}</div><div class="body">${esc(e.text)}</div></div>`;
  if (e.type === "feedback") {
    const v = e.verdict === "solid" ? "v-solid" : e.verdict === "partial" ? "v-partial" : "v-off";
    const li = (a) => (Array.isArray(a) && a.length ? a : ["—"]).map((x) => `<li>${esc(x)}</li>`).join("");
    const next = e.nextLayer;
    const kind = e.action === "fix" ? ["fix", "Rethink this part"]
      : e.action === "deeper" ? ["deeper", "Go deeper into your design"]
      : e.action === "finish" ? ["wrap", "Where you landed"]
      : ["", `Layer ${next + 1} · ${lvl(next).name} — ${esc(sys.layers[next]?.name || "")}`];
    return `<div class="msg mentor"><div class="who">Mentor · compared with real designs</div><div class="body">
      <span class="verdict ${v}">${esc(e.verdict || "")}</span><p>${esc(e.compare)}</p>
      <div class="cols"><div class="got"><h6>Holds up</h6><ul>${li(e.holds)}</ul></div><div class="miss"><h6>Missing or different</h6><ul>${li(e.gaps)}</ul></div></div>
      <div class="ask ${kind[0]}" ${next != null && e.action === "advance" ? `style="--c:${lvl(next).color}"` : ""}><span class="tag">${kind[1]}</span>${esc(e.question)}</div></div></div>`;
  }
  if (e.type === "real") return `<div class="msg mentor real"><div class="who">Mentor</div><div class="body"><span class="tag">How real designs do it · ${esc(sys.layers[e.layer].name)}</span>${esc(sys.layers[e.layer].real)}</div></div>`;
  if (e.type === "ask") return `<div class="msg mentor"><div class="who">Mentor</div><div class="body"><div class="ask" style="margin-top:0;--c:${lvl(e.layer).color}"><span class="tag">Layer ${e.layer + 1} · ${lvl(e.layer).name} — ${esc(sys.layers[e.layer].name)}</span>${esc(askFor(sys, e.layer))}</div></div></div>`;
  if (e.type === "hint") return `<div class="msg mentor"><div class="who">Mentor</div><div class="body hintbox"><span class="tag">Hint</span>${esc(e.text)}</div></div>`;
  if (e.type === "note") return `<p class="err">${esc(e.text)}</p>`;
  if (e.type === "final") return `<div class="msg mentor" style="max-width:none"><div class="who">Mentor · the complete picture</div><div class="final">
      <span class="tag">You've designed the whole system, layer by layer</span>
      <ol>${sys.layers.map((l, i) => `<li style="--c:${lvl(i).color}"><b>Layer ${i + 1} · ${lvl(i).name} — ${esc(l.name)}</b>${esc(l.real)}</li>`).join("")}</ol></div></div>`;
  return "";
}
function renderSession(sys) {
  const s = session(sys), L = sys.layers.length;
  const list = systemsOf(), idx = list.indexOf(sys);
  const next = list[idx + 1];
  $("sheet").innerHTML = `
    <p class="eyebrow">${esc(FIELDS.find((f) => f.id === sys.field).name)} · ${esc(sys.era || "")}</p>
    <h3 class="ptitle">${esc(sys.title)}</h3>
    <div class="steps" aria-label="Layers">${sys.layers.map((l, i) => `<span class="step ${s.done || i < s.layer ? "done" : i === s.layer ? "now" : ""}" style="--c:${lvl(i).color}"><small>${lvl(i).name}</small>${esc(l.name)}</span>`).join("")}</div>
    <div class="thread">${s.thread.map((e) => renderEntry(sys, e)).join("")}</div>
    <div id="live"></div>
    ${s.done ? "" : `<div class="composer">
      <label for="answer">Your answer · Layer ${s.layer + 1} of ${L}</label>
      <textarea id="answer" maxlength="2500" placeholder="Describe your method: which parts, how they connect, how they move, and why."></textarea>
      <div class="actions">
        <button class="btn primary" id="submitBtn">Submit</button>
        <button class="btn" id="hintBtn">Hint</button>
        <button class="btn" id="revealBtn">Show how real designs do it</button>
      </div>
      <div id="confirmBox"></div>
    </div>`}
    <div class="pager">
      <button class="link" id="restartBtn">Start this system over</button>
      ${next ? `<a class="btn ${s.done ? "primary" : ""}" href="/s/${next.id}" data-nav="${next.id}">Next: ${esc(next.title)} →</a>` : `<a class="btn" href="/" data-nav="home">All systems →</a>`}
    </div>
    <div id="restartBox"></div>`;
  $("restartBtn").onclick = () => {
    $("restartBox").innerHTML = `<div class="confirm" style="margin-top:12px">Clear this conversation and start over?
      <button class="btn" id="yesRestart">Start over</button><button class="link" id="noRestart">Keep it</button></div>`;
    $("yesRestart").onclick = () => { delete state.sessions[sys.id]; save(); refresh(sys); };
    $("noRestart").onclick = () => { $("restartBox").innerHTML = ""; };
  };
  if (s.done) return;
  const ta = $("answer");
  ta.value = s.draft || "";
  let tm; ta.oninput = () => { s.draft = ta.value; clearTimeout(tm); tm = setTimeout(() => writeLS("ga-state", state), 400); };
  $("submitBtn").onclick = () => submit(sys);
  $("hintBtn").onclick = () => hint(sys);
  $("revealBtn").onclick = () => reveal(sys);
}
function refresh(sys) {
  const v = currentView();
  renderPath(v); renderAccount();
  if (v.type === "sys" && v.id === sys.id) renderSession(sys);
}
function push(sys, entry) { session(sys).thread.push(entry); save(); }
function setBusy(on, label) {
  busy = on;
  ["submitBtn", "hintBtn", "revealBtn"].forEach((id) => { const b = $(id); if (b) b.disabled = on; });
  const live = $("live");
  if (live) live.innerHTML = on ? `<div class="msg mentor" style="margin-top:16px"><div class="who">Mentor</div><div class="body"><span class="thinking">${esc(label)}</span></div></div>` : "";
}
function nextLayer(sys) {
  const s = session(sys);
  s.turns = 0; s.hintIdx = 0;
  if (s.layer < sys.layers.length - 1) { s.layer++; push(sys, { type: "ask", layer: s.layer }); }
  else { s.done = true; push(sys, { type: "final" }); }
}
function conversation(sys) {
  return session(sys).thread.slice(-14).map((e) => {
    if (e.type === "problem") return "Mentor: [asked the starting question]";
    if (e.type === "answer") return `Learner (layer ${e.layer + 1}): ` + e.text.slice(0, 2000);
    if (e.type === "feedback") return "Mentor: " + e.compare + " → " + e.question;
    if (e.type === "ask") return `Mentor (opened layer ${e.layer + 1}): ` + askFor(sys, e.layer);
    if (e.type === "real") return `Mentor (showed the real design for layer ${e.layer + 1})`;
    if (e.type === "hint") return "Mentor hint: " + e.text;
    return "";
  }).filter(Boolean).join("\n\n");
}
const useAi = () => !!auth && state.aiOn && (auth.remaining ?? 1) > 0;

async function submit(sys) {
  if (busy) return;
  const s = session(sys), ta = $("answer"), text = ta.value.trim();
  if (!text) { $("confirmBox").innerHTML = `<p class="err">Describe your idea first — rough is fine.</p>`; ta.focus(); return; }
  const convo = conversation(sys);
  push(sys, { type: "answer", text, layer: s.layer });
  s.draft = ""; save();
  if (!useAi()) { push(sys, { type: "real", layer: s.layer }); nextLayer(sys); refresh(sys); return; }

  refresh(sys);
  setBusy(true, "Comparing your method with real designs");
  try {
    const r = await api("/api/mentor", { method: "POST", body: JSON.stringify({ systemId: sys.id, kind: "answer", layer: s.layer, turns: s.turns, conversation: convo, answer: text }) });
    auth.remaining = r.remaining; writeLS("ga-auth", auth);
    const last = s.layer === sys.layers.length - 1;
    let action = r.result.action;
    if (action === "finish" && !last) action = "advance";
    if (action === "advance" && last) action = "finish";
    if ((action === "deeper" || action === "fix") && s.turns >= 3) action = last ? "finish" : "advance";
    const entry = { type: "feedback", ...r.result, action };
    if (action === "advance") { entry.nextLayer = s.layer + 1; s.layer++; s.turns = 0; s.hintIdx = 0; }
    else if (action !== "finish") s.turns++;
    push(sys, entry);
    if (action === "finish") { s.done = true; push(sys, { type: "final" }); }
  } catch (e) {
    if (e.status === 429 && e.data?.error === "quota") {
      if (e.data.scope === "user") { auth.remaining = 0; writeLS("ga-auth", auth); }
      push(sys, { type: "note", text: `${e.data.message} Continuing with the built-in path — here's how real designs do it.` });
      push(sys, { type: "real", layer: s.layer }); nextLayer(sys);
    } else {
      // Take the answer back so the learner can resend it.
      s.thread.pop(); s.draft = text; save();
      push(sys, { type: "note", text: e.data?.message || "The mentor's reply didn't come through. Submit again." });
    }
  } finally { setBusy(false); refresh(sys); }
}
async function hint(sys) {
  if (busy) return;
  const s = session(sys);
  if (!useAi()) {
    const text = s.layer === 0 && s.hintIdx < (sys.hints || []).length ? sys.hints[s.hintIdx++]
      : "Picture the part you described actually moving. What holds it, what guides it, and what happens when it's under load or wears out?";
    push(sys, { type: "hint", text }); refresh(sys); return;
  }
  setBusy(true, "Thinking of a nudge");
  try {
    const r = await api("/api/mentor", { method: "POST", body: JSON.stringify({ systemId: sys.id, kind: "hint", layer: s.layer, turns: s.turns, conversation: conversation(sys) }) });
    auth.remaining = r.remaining; writeLS("ga-auth", auth);
    push(sys, { type: "hint", text: r.hint });
  } catch (e) {
    if (e.status === 429 && e.data?.scope === "user") { auth.remaining = 0; writeLS("ga-auth", auth); }
    push(sys, { type: "note", text: e.data?.message || "The hint didn't come through. Try again." });
  } finally { setBusy(false); refresh(sys); }
}
function reveal(sys) {
  if (busy) return;
  const s = session(sys);
  const answered = s.thread.some((e) => e.type === "answer" && e.layer === s.layer);
  const cb = $("confirmBox");
  if (!answered && !cb.dataset.ok) {
    cb.innerHTML = `<div class="confirm">You haven't answered this layer yet — it sticks better if you try first.
      <button class="btn" id="yesReveal">Show it anyway</button><button class="link" id="noReveal">I'll try first</button></div>`;
    $("yesReveal").onclick = () => { cb.dataset.ok = "1"; cb.innerHTML = ""; reveal(sys); };
    $("noReveal").onclick = () => { cb.innerHTML = ""; $("answer").focus(); };
    return;
  }
  push(sys, { type: "real", layer: s.layer });
  nextLayer(sys); refresh(sys);
}

// ---------------------------------------------------------------- ads (only when configured by the server)
function fillAds() {
  const cfg = window.GA_ADS || {};
  if (!cfg.client) return;
  for (const [slotName, elId] of [["top", "ad-top"], ["side", "ad-side"], ["bottom", "ad-bottom"]]) {
    const slot = cfg.slots?.[slotName];
    if (!slot) continue;
    const box = $(elId);
    box.hidden = false;
    box.innerHTML = `<ins class="adsbygoogle" style="display:block" data-ad-client="${esc(cfg.client)}" data-ad-slot="${esc(slot)}" data-ad-format="auto" data-full-width-responsive="true"></ins>`;
    try { (window.adsbygoogle = window.adsbygoogle || []).push({}); } catch {}
  }
}

// ---------------------------------------------------------------- boot
(async function boot() {
  try {
    SYSTEMS = await (await fetch("/systems.json")).json();
  } catch {
    $("sheet").innerHTML = `<p class="err">Couldn't load the systems. Refresh the page to try again.</p>`;
    return;
  }
  if (!FIELDS.some((f) => f.id === state.field)) state.field = "mechanical";
  try { freeDaily = (await (await fetch("/api/config")).json()).freeDaily ?? 5; } catch {}
  renderAll(false);
  fillAds();
  if (auth) {
    try {
      const me = await api("/api/me");
      auth.remaining = me.remaining; writeLS("ga-auth", auth);
      const p = await api("/api/progress");
      mergeProgress(p.data?.sessions || {});
      writeLS("ga-state", state);
      renderAll(false);
    } catch {}
  }
})();
