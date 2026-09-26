// Gearhead Academy — browser app. Talks to the Worker API for accounts, progress sync and the AI mentor.
const LEVELS = [
  { name: "Student", color: "var(--l1)" },
  { name: "Junior", color: "var(--l2)" },
  { name: "Mid-level", color: "var(--l3)" },
  { name: "Senior", color: "var(--l4)" },
  { name: "Modern", color: "var(--l5)" },
];
let FIELDS = []; // loaded from /fields.json
const fieldOf = (id = state.field) => FIELDS.find((f) => f.id === id) || FIELDS[0];
const slugify = (t) => t.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 48);
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
const state = Object.assign({ field: "mechanical", sessions: {}, custom: [], aiOn: true }, readLS("ga-state", {}));
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
  if (!auth) return false;
  try { await api("/api/progress", { method: "PUT", body: JSON.stringify({ sessions: state.sessions, custom: state.custom }) }); return true; }
  catch { return false; }
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
  if (!res.ok) {
    if (!data.message) data.message = res.status >= 500 ? `The server had a problem (error ${res.status}). Try again in a moment.` : `Request failed (error ${res.status}).`;
    throw Object.assign(new Error(data.message), { status: res.status, data });
  }
  return data;
}

// ---------------------------------------------------------------- routing
const allSystems = () => [...SYSTEMS, ...state.custom];
const byId = (id) => allSystems().find((s) => s.id === id);
const systemsOf = () => SYSTEMS.filter((s) => s.field === state.field);
const customOf = () => state.custom.filter((s) => s.field === state.field);
function currentView() {
  const m = location.pathname.match(/^\/s\/([a-z0-9-]+)\/?$/);
  if (m && byId(m[1])) { state.field = byId(m[1]).field; return { type: "sys", id: m[1] }; }
  if (m && writing?.id === m[1]) return { type: "writing", id: m[1] };
  if (m && m[1].startsWith("x-")) { loadTopic(m[1]); return { type: "loading", id: m[1] }; }
  return { type: "home" };
}
// A topic someone else explored (shared link) — fetch it once, then keep it in "Your topics".
const loadingTopics = new Set();
async function loadTopic(id) {
  if (loadingTopics.has(id)) return;
  loadingTopics.add(id);
  try {
    const r = await fetch(`/api/topic/${id}`);
    if (!r.ok) throw new Error();
    const sys = (await r.json()).system;
    if (!byId(sys.id)) { state.custom.push(sys); save(); }
  } catch {
    $("sheet").innerHTML = `<p class="err">That topic couldn't be found. <a href="/" data-nav="home">Back to all systems</a></p>`;
    return;
  } finally { loadingTopics.delete(id); }
  renderAll(false);
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
  renderAccount(); renderPath(v); renderMain(v); renderNotes(v);
  const sys = v.type === "sys" ? byId(v.id) : null;
  document.title = sys ? `How a ${sys.title} works — Gearhead Academy` : "Gearhead Academy — learn how things work by designing them";
  if (scroll) $("sheet").scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "start" });
}
function renderAccount() {
  const box = $("account");
  if (auth) {
    box.innerHTML = `<div class="acc-row"><span>Signed in as <span class="who">${esc(auth.username)}</span></span>
        <button class="link" id="logoutBtn" type="button">Sign out</button></div>
      <label class="toggle"><input type="checkbox" id="aiToggle" ${state.aiOn ? "checked" : ""}> AI mentor · ${auth.remaining ?? "–"} of ${freeDaily} replies left today</label>`;
    $("aiToggle").onchange = (e) => { state.aiOn = e.target.checked; save(); renderAll(false); };
    $("logoutBtn").onclick = () => signOut(false);
  } else {
    box.innerHTML = `<form id="loginForm" aria-label="Sign in">
      <div class="acc-row"><input type="text" id="uName" placeholder="Username" aria-label="Username" autocomplete="username" maxlength="20" required>
      <input type="password" id="uPin" placeholder="PIN (4–8 digits)" aria-label="PIN" inputmode="numeric" autocomplete="current-password" maxlength="8" required>
      <button class="btn primary" type="submit">Sign in</button></div>
      <span class="note" id="loginMsg">Free — new usernames are created automatically. Saves progress and unlocks the AI mentor. No PIN recovery.</span></form>`;
    $("loginForm").onsubmit = (e) => { e.preventDefault(); login(); };
  }
}
// Sign out: save progress to the account first, then clear this browser's copy so the next
// person on this device starts fresh. Everything comes back on the next sign-in.
async function signOut(force) {
  const btn = $("logoutBtn");
  if (btn) { btn.disabled = true; btn.textContent = "Saving…"; }
  clearTimeout(syncTimer);
  const saved = await pushProgress();
  if (!saved && !force) {
    $("account").insertAdjacentHTML("beforeend", `<div class="note" id="signOutWarn">Couldn't save your latest progress to your account (are you offline?). Signing out now would lose it on this device.
      <button class="link" type="button" id="signOutAnyway">Sign out anyway</button></div>`);
    $("signOutAnyway").onclick = () => signOut(true);
    if (btn) { btn.disabled = false; btn.textContent = "Sign out"; }
    return;
  }
  try { await api("/api/logout", { method: "POST" }); } catch {}
  auth = null; writeLS("ga-auth", null);
  state.sessions = {}; state.custom = [];
  writeLS("ga-state", state);
  renderAll(false);
}
async function login() {
  const msg = $("loginMsg");
  msg.textContent = "Signing in…";
  try {
    const r = await api("/api/login", { method: "POST", body: JSON.stringify({ username: $("uName").value, pin: $("uPin").value }) });
    auth = { token: r.token, username: r.username, remaining: r.remaining };
    writeLS("ga-auth", auth);
    const p = await api("/api/progress");
    mergeProgress(p.data);
    save(); await pushProgress();
    renderAll(false);
  } catch (e) { msg.textContent = e.data?.message || "Couldn't sign in. Check your connection and try again."; }
}
// Keep whichever copy of each system has gone further, and every custom topic from either side.
function mergeProgress(server) {
  if (!server) return;
  const score = (s) => (s ? (s.done ? 1000 : 0) + s.layer * 50 + (s.thread?.length || 0) : -1);
  for (const [id, s] of Object.entries(server.sessions || {})) if (score(s) > score(state.sessions[id])) state.sessions[id] = s;
  for (const sys of server.custom || []) {
    const i = state.custom.findIndex((x) => x.id === sys.id);
    if (i < 0) state.custom.push(sys);
    else if ((sys.v || 1) > (state.custom[i].v || 1)) state.custom[i] = sys;
  }
}
// Left sidebar: field dropdown, its disclaimer, and its topics (systems, suggested, yours).
function renderPath(v) {
  const field = fieldOf();
  const current = (id) => (v.type === "sys" && v.id === id ? `aria-current="page"` : "");
  const item = (s) => `<li><a class="sysbtn" href="/s/${s.id}" data-nav="${s.id}" ${current(s.id)}>
      <span>${esc(s.title)}</span><span class="era">${esc(s.era || "")}</span>${dots(s)}</a></li>`;
  const builtins = systemsOf();
  const suggested = (field.suggestions || []).filter((n) => !builtins.some((s) => slugify(s.title) === slugify(n)));
  const suggestedIds = new Set(suggested.map((n) => `x-${slugify(n)}`));
  const suggestItem = (n) => {
    const sys = byId(`x-${slugify(n)}`);
    const busyHere = writing?.id === `x-${slugify(n)}` && !writing.error;
    return sys ? item(sys) : `<li><button class="sysbtn" type="button" data-suggest="${esc(n)}" ${current(`x-${slugify(n)}`)}><span>${esc(n)}</span><span class="era">${busyHere ? "Writing…" : "Not opened yet"}</span></button></li>`;
  };
  const mine = customOf().filter((s) => !suggestedIds.has(s.id));
  $("path").innerHTML = `
    <label class="fieldlbl" for="fieldSelect">Field</label>
    <select id="fieldSelect">${FIELDS.map((f) => `<option value="${f.id}" ${f.id === field.id ? "selected" : ""}>${esc(f.name)}</option>`).join("")}</select>
    <p class="trust side">Lessons in ${esc(field.name)} are written by AI and haven't been reviewed by an expert yet. They're a starting point — double-check anything important.${field.id === "biology" ? " Educational only — not medical advice." : ""}</p>
    ${builtins.length ? `<h2>Systems</h2><ol class="syslist">${builtins.map(item).join("")}</ol>` : ""}
    ${suggested.length ? `<h2>${builtins.length ? "More topics" : "Topics"}</h2><ol class="syslist">${suggested.map(suggestItem).join("")}</ol>` : ""}
    ${mine.length ? `<h2>Your topics</h2><ol class="syslist">${mine.map(item).join("")}</ol>` : ""}
    <p class="note" id="sideMsg" aria-live="polite"></p>`;
  $("fieldSelect").onchange = (e) => {
    state.field = e.target.value; save();
    if (v.type === "home") renderPath(v); else go({ type: "home" });
  };
  $("path").querySelectorAll("[data-suggest]").forEach((b) => (b.onclick = () => openSuggestion(b.dataset.suggest)));
  const list = [...builtins, ...customOf()];
  const done = list.filter((s) => state.sessions[s.id]?.done).length;
  $("doneCount").textContent = `${done}/${list.length}`;
  $("doneBar").style.width = (list.length ? (done / list.length) * 100 : 0) + "%";
}
function renderMain(v) {
  if (v.type === "loading") { $("sheet").innerHTML = `<p class="thinking">Loading this topic</p>`; return; }
  if (v.type === "writing") return renderWriting();
  v.type === "home" ? renderHome() : renderSession(byId(v.id));
}

// ---------------------------------------------------------------- explore any topic
function exploreForm(where) {
  return `<form class="explore ${where}" id="explore-${where}">
    <label for="topic-${where}">${where === "home" ? "Explore any topic" : "Explore another topic"}</label>
    <div class="row"><input type="text" id="topic-${where}" maxlength="60" placeholder="${esc(fieldOf().placeholder || "")}">
    <button class="btn ${where === "home" ? "primary" : ""}" type="submit">Explore</button></div>
    <span class="note" id="topicMsg-${where}">${auth ? "Writes a new 5-layer lesson. Uses 1 of today's new-topic allowance." : "Sign in to explore your own topics — the suggested ones are free to open."}</span></form>`;
}
function bindExplore(where) {
  const f = $(`explore-${where}`);
  if (f) f.onsubmit = (e) => { e.preventDefault(); explore(where); };
}
async function explore(where) {
  const input = $(`topic-${where}`), msg = $(`topicMsg-${where}`);
  const topic = input.value.trim().replace(/\s+/g, " ");
  if (topic.length < 3) { msg.textContent = "Type a topic, e.g. \"bicycle gears\"."; input.focus(); return; }
  writeTopic(topic);
}
// Add (or refresh) a generated topic in this learner's list and open it.
function addTopic(sys) {
  if (!sys.custom) return; // it was a built-in system
  const i = state.custom.findIndex((x) => x.id === sys.id);
  if (i < 0) state.custom.push(sys);
  else if ((state.custom[i].v || 1) !== (sys.v || 1)) { state.custom[i] = sys; delete state.sessions[sys.id]; } // rewritten lesson
  save();
}
function adoptTopic(sys) { addTopic(sys); go({ type: "sys", id: sys.id }); }
// Suggested topics: written once for everyone, open without signing in.
function openSuggestion(name) { writeTopic(name); }

// Writing a new lesson: switch to its page straight away and show progress there,
// then the lesson itself — or the reason it failed, with Try again.
let writing = null; // { id, name, field, error }
async function writeTopic(name) {
  const id = `x-${slugify(name)}`;
  if (byId(id)) return go({ type: "sys", id });
  if (writing?.id === id && !writing.error) return go({ type: "sys", id }); // already in progress
  writing = { id, name, field: state.field, error: null, started: Date.now() };
  go({ type: "sys", id });
  try {
    const r = await api("/api/generate", { method: "POST", body: JSON.stringify({ topic: name, field: writing.field }) });
    const onPage = location.pathname.replace(/\/$/, "") === `/s/${id}`;
    writing = null;
    if (onPage) return adoptTopic(r.system);
    addTopic(r.system); // learner moved on — just add it to their list
    renderAll(false);
  } catch (e) {
    if (writing?.id !== id) return;
    writing.error = e.data?.message || "Couldn't write that lesson. Try again.";
    if (currentView().type === "writing") renderAll(false);
  }
}
function renderWriting() {
  const w = writing;
  $("sheet").innerHTML = `
    <p class="eyebrow">${esc(fieldOf(w.field).name)}</p>
    <h3 class="ptitle">${esc(w.name)}</h3>
    ${w.error
      ? `<p class="err">${esc(w.error)}</p>
         <div class="actions" style="margin-top:14px"><button class="btn primary" id="retryWrite" type="button">Try again</button>
         <a class="btn" href="/" data-nav="home">Back to topics</a></div>`
      : `<p class="thinking">Writing this lesson — this happens once, then it's saved for everyone. Usually 10–30 seconds</p>
         <p class="note">You can keep browsing; it will appear under your topics when it's ready.</p>`}`;
  const retry = $("retryWrite");
  if (retry) retry.onclick = () => { const n = w.name; writing = null; writeTopic(n); };
}
// Shown on every lesson, plus a health notice in the medicine field.
function trustNote(sys) {
  return `<p class="trust">Written by AI and not yet reviewed by an expert — double-check anything important.${sys.field === "biology" ? " Educational only — not medical advice." : ""}</p>`;
}
function renderNotes(v) {
  const sys = v.type === "sys" ? byId(v.id) : null;
  $("aboutTop").hidden = !!sys;
  if (!sys) {
    if ($("notes").dataset.client) $("notes").innerHTML = "";
    return;
  }
  $("notes").dataset.client = "1";
  $("notes").innerHTML = `<h2>How does a ${esc(sys.title.toLowerCase())} work?</h2><p>${esc(sys.prompt)}</p>
    <details><summary>Reference notes: how real designs do it (spoilers)</summary>
    ${sys.layers.map((l, i) => `<h4>Layer ${i + 1} · ${esc(l.name)}</h4><p>${esc(l.real)}</p>`).join("")}</details>`;
}

// ---------------------------------------------------------------- home
// How feedback works — explained on the home page and at the start of every lesson.
function feedbackPanel() {
  return `<section class="howfb" aria-label="How feedback works">
    <h4 class="sec" style="margin-top:0">How feedback works</h4>
    <div class="howfb-cols">
      <div class="${auth ? "" : "here"}"><b>Without signing in</b><p>After each answer you see a fixed "how real designs do it" answer, then move to the next layer. Free, but it doesn't read what you wrote.</p></div>
      <div class="${auth ? "here" : ""}"><b>Signed in — free, just a username and PIN</b><p>The AI mentor reads your answer, says what holds up and what's missing, and asks follow-up questions about <em>your</em> design. ${freeDaily} replies a day; after that you get the fixed answers.</p></div>
    </div>
    <p class="note">${auth ? `You're signed in as <b>${esc(auth.username)}</b>. ${state.aiOn ? `AI mentor on — ${auth.remaining ?? "–"} replies left today.` : "AI mentor is switched off — turn it on under Submit or at the top right."}` : `Sign in with the box at the top right of the page${matchMedia("(max-width: 860px)").matches ? " (scroll up)" : ""}.`}</p>
  </section>`;
}
function pathNote() {
  if (!auth) return "Not signed in: after you answer you'll see the fixed built-in answer, not feedback on your own design. Sign in (free) to get the AI mentor.";
  if (!state.aiOn) return "AI mentor is off: you'll see the fixed built-in answer. Turn it on under Submit.";
  if ((auth.remaining ?? 1) <= 0) return "No AI mentor replies left today: you'll see the fixed built-in answer until tomorrow.";
  return "AI mentor on: it will read your answer and give feedback on your own design.";
}
// Home (right side): the same for every field — the field only changes the sidebar's topics.
function renderHome() {
  $("sheet").innerHTML = `
    <h3 class="ptitle">Pick a topic to design</h3>
    <p class="intro">Choose a field and a topic from the topic list, or type any topic below. Each one starts with a problem to solve. Answer in plain words: which parts you'd use, how they connect and move, and why. Every topic goes through five layers:</p>
    <ol class="ladder">${LEVELS.map((l, i) => `<li style="--c:${l.color}"><span class="lvl">Layer ${i + 1} · ${l.name}</span><span>${LAYER_BLURBS[i]}</span></li>`).join("")}</ol>
    ${exploreForm("home")}
    ${feedbackPanel()}`;
  bindExplore("home");
}

// ---------------------------------------------------------------- guided session
function renderEntry(sys, e) {
  if (e.type === "problem") return `<div class="msg mentor"><div class="who">Mentor · Layer 1 · ${lvl(0).name}</div><div class="body"><p>${esc(sys.prompt)}</p><p class="note">No calculations needed — describe the parts, how they connect and move, and why.</p><p class="note">${pathNote()}</p></div></div>`;
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
  if (e.type === "real") return `<div class="msg mentor real"><div class="who">Mentor</div><div class="body"><span class="tag">How real designs do it · ${esc(sys.layers[e.layer].name)} · built-in answer</span>${esc(sys.layers[e.layer].real)}${auth ? "" : `<p class="note" style="margin:10px 0 0">This is the same fixed answer everyone sees — it doesn't look at what you wrote. Sign in (free, any username and PIN) to get the AI mentor's feedback on your own design, then use “Start this system over” to resubmit.</p>`}</div></div>`;
  if (e.type === "ask") return `<div class="msg mentor"><div class="who">Mentor</div><div class="body"><div class="ask" style="margin-top:0;--c:${lvl(e.layer).color}"><span class="tag">Layer ${e.layer + 1} · ${lvl(e.layer).name} — ${esc(sys.layers[e.layer].name)}</span>${esc(askFor(sys, e.layer))}</div></div></div>`;
  if (e.type === "hint") return `<div class="msg mentor"><div class="who">Mentor</div><div class="body hintbox"><span class="tag">Hint</span>${esc(e.text)}</div></div>`;
  if (e.type === "explain") return `<div class="msg mentor"><div class="who">Mentor · explained</div><div class="body"><span class="tag">Layer ${e.layer + 1} explained — tap underlined words, or select a hard passage to simplify it</span><div class="xbody" data-src="layer:${sys.id}:${e.layer}">${linkify(e.text)}</div></div></div>`;
  if (e.type === "note") return `<p class="err">${esc(e.text)}</p>`;
  if (e.type === "final") return `<div class="msg mentor" style="max-width:none"><div class="who">Mentor · the complete picture</div><div class="final">
      <span class="tag">You've designed the whole system, layer by layer</span>
      <ol>${sys.layers.map((l, i) => `<li style="--c:${lvl(i).color}"><b>Layer ${i + 1} · ${lvl(i).name} — ${esc(l.name)}</b>${esc(l.real)}</li>`).join("")}</ol></div></div>`;
  return "";
}
function modeSwitch(s) {
  const explain = s.mode === "explain";
  return `<div class="modebar"><div class="modes" role="group" aria-label="How do you want to learn this?">
      <button data-mode="design" aria-pressed="${!explain}">Design it myself</button>
      <button data-mode="explain" aria-pressed="${explain}">Explain it to me</button></div>
    <span class="note">${explain ? "Read each layer explained from scratch. Tap underlined words to dig deeper, or select a hard passage to have it explained more simply." : "You describe your design; the mentor compares it with real ones and takes you deeper."}</span></div>`;
}
// Topics written with an older version of the lesson prompt can be rewritten in place.
const CURRENT_TOPIC_VERSION = 2;
function outdatedBanner(sys) {
  if (!sys.custom || (sys.v || 1) >= CURRENT_TOPIC_VERSION) return "";
  return `<div class="confirm" style="margin:0 0 14px">This lesson was written in an older format that doesn't start from the problem it solves.
    <button class="btn primary" id="rewriteBtn" type="button">Rewrite this lesson</button><span class="note" id="rewriteMsg">${auth ? "Uses 1 of today's new-topic allowance and restarts this topic." : "Sign in first."}</span></div>`;
}
function bindOutdated(sys) {
  const b = $("rewriteBtn");
  if (!b) return;
  b.onclick = async () => {
    const msg = $("rewriteMsg");
    if (!auth) { msg.textContent = "Sign in at the top of the page first."; return; }
    b.disabled = true;
    msg.innerHTML = `<span class="thinking">Rewriting</span>`;
    try {
      const r = await api("/api/generate", { method: "POST", body: JSON.stringify({ topic: sys.topic || sys.title, field: sys.field }) });
      const i = state.custom.findIndex((x) => x.id === sys.id);
      if (r.system.id === sys.id && i >= 0) { state.custom[i] = r.system; delete state.sessions[sys.id]; }
      else if (!byId(r.system.id)) state.custom.push(r.system);
      save();
      go({ type: "sys", id: r.system.id });
    } catch (e) { msg.textContent = e.data?.message || "Couldn't rewrite it. Try again."; b.disabled = false; }
  };
}
function bindModeSwitch(sys) {
  document.querySelectorAll(".modes button").forEach((b) => (b.onclick = () => {
    const s = session(sys);
    if ((s.mode || "design") === b.dataset.mode) return;
    s.mode = b.dataset.mode; save(); renderSession(sys);
  }));
}
function renderSession(sys) {
  const s = session(sys), L = sys.layers.length;
  if (s.mode === "explain") return renderExplainMode(sys);
  const list = systemsOf(), idx = list.indexOf(sys);
  const next = list[idx + 1];
  $("sheet").innerHTML = `
    <p class="eyebrow">${esc(fieldOf(sys.field).name)} · ${esc(sys.era || "")}</p>
    <h3 class="ptitle">${esc(sys.title)}</h3>
    ${trustNote(sys)}${modeSwitch(s)}${outdatedBanner(sys)}
    <div class="steps" aria-label="Layers">${sys.layers.map((l, i) => `<span class="step ${s.done || i < s.layer ? "done" : i === s.layer ? "now" : ""}" style="--c:${lvl(i).color}"><small>${lvl(i).name}</small>${esc(l.name)}</span>`).join("")}</div>
    <div class="thread">${s.thread.map((e) => renderEntry(sys, e)).join("")}</div>
    <div id="live"></div>
    ${s.done ? "" : `<div class="composer">
      <label for="answer">Your answer · Layer ${s.layer + 1} of ${L}</label>
      <textarea id="answer" maxlength="2500" placeholder="Describe your method: which parts, how they connect, how they move, and why."></textarea>
      <div class="actions">
        <button class="btn primary" id="submitBtn">Submit</button>
        <button class="btn" id="hintBtn">Hint</button>
        <button class="btn" id="explainBtn">I'm stuck — explain this layer</button>
        <button class="btn" id="revealBtn">Show how real designs do it</button>
      </div>
      <div class="aistatus" id="aiStatus">${aiStatusHtml()}</div>
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
  bindModeSwitch(sys); bindOutdated(sys);
  if (s.done) return;
  const ta = $("answer");
  ta.value = s.draft || "";
  let tm; ta.oninput = () => { s.draft = ta.value; clearTimeout(tm); tm = setTimeout(() => writeLS("ga-state", state), 400); };
  $("submitBtn").onclick = () => submit(sys);
  $("hintBtn").onclick = () => hint(sys);
  $("explainBtn").onclick = () => explainHere(sys);
  $("revealBtn").onclick = () => reveal(sys);
  bindAiStatus(sys);
}

// ---------------------------------------------------------------- explanations
// Text from the server marks linkable terms as [[term]] or [[term|shown text]].
function linkify(text) {
  return String(text || "").split(/\n\s*\n/).filter((p) => p.trim()).map((p) =>
    `<p>${esc(p.trim()).replace(/\[\[([^\[\]|]{1,60})(?:\|([^\[\]]{1,60}))?\]\]/g,
      (_, term, shown) => `<button type="button" class="term" data-term="${term}">${shown || term}</button>`)}</p>`).join("");
}
const layerCache = new Map();
const layerKey = (sys, layer) => `${sys.id}@${sys.v || 1}/${layer}`;
async function fetchLayerExplanation(sys, layer) {
  const key = layerKey(sys, layer);
  if (layerCache.has(key)) return layerCache.get(key);
  const r = await api("/api/explain", { method: "POST", body: JSON.stringify({ systemId: sys.id, layer }) });
  layerCache.set(key, r.text);
  return r.text;
}
async function explainHere(sys) {
  if (busy) return;
  const s = session(sys);
  setBusy(true, "Explaining this layer");
  try {
    const text = await fetchLayerExplanation(sys, s.layer);
    push(sys, { type: "explain", layer: s.layer, text });
  } catch (e) {
    push(sys, { type: "note", text: e.data?.message || "The explanation didn't come through. Try again." });
  } finally { setBusy(false); refresh(sys); }
}

// Explain mode: the layers explained in order, one at a time.
function renderExplainMode(sys) {
  const s = session(sys), L = sys.layers.length;
  s.readUpTo = Math.min(L - 1, Math.max(s.readUpTo || 0, 0));
  const list = systemsOf(), idx = list.indexOf(sys), next = list[idx + 1];
  const sections = [];
  for (let i = 0; i <= s.readUpTo; i++) {
    const cached = layerCache.get(layerKey(sys, i));
    sections.push(`<section class="xlayer" style="--c:${lvl(i).color}">
      <span class="tag">Layer ${i + 1} · ${lvl(i).name} — ${esc(sys.layers[i].name)}</span>
      <p class="xq">${esc(askFor(sys, i))}</p>
      <div class="xbody" id="xl-${i}" data-src="layer:${sys.id}:${i}">${cached ? linkify(cached) : `<span class="thinking">Writing the explanation</span>`}</div>
      <div class="actions"><button class="btn" data-try="${i}">Try this layer myself</button></div>
    </section>`);
  }
  $("sheet").innerHTML = `
    <p class="eyebrow">${esc(fieldOf(sys.field).name)} · ${esc(sys.era || "")}</p>
    <h3 class="ptitle">${esc(sys.title)}</h3>
    ${trustNote(sys)}${modeSwitch(s)}${outdatedBanner(sys)}
    <div class="steps" aria-label="Layers">${sys.layers.map((l, i) => `<span class="step ${i < s.readUpTo ? "done" : i === s.readUpTo ? "now" : ""}" style="--c:${lvl(i).color}"><small>${lvl(i).name}</small>${esc(l.name)}</span>`).join("")}</div>
    <div class="xlayers">${sections.join("")}</div>
    <div class="actions" style="margin-top:18px">
      ${s.readUpTo < L - 1 ? `<button class="btn primary" id="xNext">Next: Layer ${s.readUpTo + 2} · ${esc(sys.layers[s.readUpTo + 1].name)} →</button>`
        : `<span class="note">That's all five layers — from the first idea to today's designs.</span>`}
    </div>
    <div class="pager">
      <button class="link" id="xDesign">Switch to design mode</button>
      ${next ? `<a class="btn" href="/s/${next.id}" data-nav="${next.id}">Next: ${esc(next.title)} →</a>` : `<a class="btn" href="/" data-nav="home">All systems →</a>`}
    </div>`;
  bindModeSwitch(sys); bindOutdated(sys);
  $("xDesign").onclick = () => { s.mode = "design"; save(); renderSession(sys); };
  const nb = $("xNext");
  if (nb) nb.onclick = () => { s.readUpTo++; save(); renderSession(sys); $(`xl-${s.readUpTo}`)?.scrollIntoView({ behavior: "smooth", block: "start" }); };
  $("sheet").querySelectorAll("[data-try]").forEach((b) => (b.onclick = () => startDesignAt(sys, +b.dataset.try)));
  // Fill in any explanations not loaded yet.
  (async () => {
    for (let i = 0; i <= s.readUpTo; i++) {
      if (layerCache.has(layerKey(sys, i))) continue;
      const box = () => $(`xl-${i}`);
      try {
        const text = await fetchLayerExplanation(sys, i);
        if (box()) box().innerHTML = linkify(text);
      } catch (e) {
        if (box()) box().innerHTML = `<p class="err">${esc(e.data?.message || "The explanation didn't come through.")}</p><button class="btn" data-retry>Try again</button>`;
        box()?.querySelector("[data-retry]")?.addEventListener("click", () => renderSession(sys));
        break;
      }
    }
  })();
}
// Jump from explain mode into design mode at a given layer.
function startDesignAt(sys, layer) {
  const s = session(sys);
  s.mode = "design";
  if (!s.done && layer > s.layer) {
    s.layer = layer; s.turns = 0; s.hintIdx = 0;
    push(sys, { type: "ask", layer });
  }
  save(); refresh(sys);
  $("answer")?.focus();
}

// The side panel shows a stack of entries: a term ({kind:"term", term}) or a simplified passage
// ({kind:"simplify", text, src}). Tap terms inside to go deeper; Back steps out.
const panelCache = new Map();
let panelStack = [];
document.addEventListener("click", (e) => {
  const t = e.target.closest(".term");
  if (!t) return;
  e.preventDefault();
  openPanel({ kind: "term", term: t.dataset.term }, !t.closest("#explainer"));
});
document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !$("explainer").hidden) closePanel(); });
function openPanel(entry, fresh) {
  panelStack = fresh ? [entry] : [...panelStack, entry];
  showPanel();
}
function closePanel() { $("explainer").hidden = true; panelStack = []; }
const entryLabel = (en) => (en.kind === "term" ? en.term : "In simpler words");
const entryKey = (en) => (en.kind === "term" ? `term:${en.term.toLowerCase()}` : `simplify:${en.src}|${en.text}`);
async function showPanel() {
  const entry = panelStack[panelStack.length - 1], body = $("xBody");
  $("explainer").hidden = false;
  $("xBack").hidden = panelStack.length < 2;
  $("xCrumbs").innerHTML = panelStack.map((en, i) => i === panelStack.length - 1 ? `<b>${esc(entryLabel(en))}</b>` : esc(entryLabel(en))).join(" › ");
  $("xTitle").textContent = entryLabel(entry);
  $("xQuote").hidden = entry.kind !== "simplify";
  $("xQuote").textContent = entry.kind === "simplify" ? entry.text : "";
  const stillShowing = () => panelStack[panelStack.length - 1] === entry;
  const fill = (r) => {
    body.dataset.src = entry.kind === "term" ? `term:${entry.term}` : `simplify:${r.key}`;
    body.innerHTML = linkify(r.text);
  };
  $("xClose").focus();
  const cached = panelCache.get(entryKey(entry));
  if (cached) return fill(cached);
  body.dataset.src = "";
  body.innerHTML = `<span class="thinking">${entry.kind === "term" ? `Explaining ${esc(entry.term)}` : "Rewriting it more simply"}</span>`;
  try {
    const v = currentView();
    const r = entry.kind === "term"
      ? await api("/api/term", { method: "POST", body: JSON.stringify({ term: entry.term, systemId: v.type === "sys" ? v.id : undefined }) })
      : await api("/api/simplify", { method: "POST", body: JSON.stringify({ text: entry.text, src: entry.src }) });
    panelCache.set(entryKey(entry), r);
    if (stillShowing()) fill(r);
  } catch (e) {
    if (stillShowing()) body.innerHTML = `<p class="err">${esc(e.data?.message || "That explanation didn't come through. Try again.")}</p>`;
  }
}
$("xBack").onclick = () => { panelStack.pop(); showPanel(); };
$("xClose").onclick = closePanel;

// Select a hard passage inside any explanation → a floating "Explain this more simply" button.
let pendingSimplify = null;
function updateSimplifyButton() {
  const btn = $("simplifyBtn"), sel = getSelection();
  const hide = () => { btn.hidden = true; pendingSimplify = null; };
  if (!sel || sel.isCollapsed || !sel.rangeCount) return hide();
  const text = sel.toString().replace(/\s+/g, " ").trim();
  if (text.length < 15) return hide();
  const within = (node) => (node?.nodeType === 1 ? node : node?.parentElement)?.closest("[data-src]");
  const box = within(sel.anchorNode);
  if (!box || box !== within(sel.focusNode) || !box.dataset.src) return hide();
  pendingSimplify = { text: text.slice(0, 1200), src: box.dataset.src, inPanel: !!box.closest("#explainer") };
  const r = sel.getRangeAt(0).getBoundingClientRect();
  btn.hidden = false;
  const w = btn.offsetWidth, h = btn.offsetHeight;
  const below = r.bottom + 10 + h < innerHeight;
  btn.style.top = `${below ? r.bottom + 10 : Math.max(8, r.top - h - 10)}px`;
  btn.style.left = `${Math.min(Math.max(8, r.left + r.width / 2 - w / 2), innerWidth - w - 8)}px`;
}
let selTimer;
document.addEventListener("selectionchange", () => { clearTimeout(selTimer); selTimer = setTimeout(updateSimplifyButton, 120); });
addEventListener("scroll", () => { if (!$("simplifyBtn").hidden) updateSimplifyButton(); }, { passive: true, capture: true });
// Keep the selection alive when the button is pressed (desktop and touch).
$("simplifyBtn").addEventListener("pointerdown", (e) => e.preventDefault());
$("simplifyBtn").onclick = () => {
  if (!pendingSimplify) return;
  const { inPanel, ...rest } = pendingSimplify;
  $("simplifyBtn").hidden = true;
  getSelection()?.removeAllRanges();
  // From the page: start a fresh panel. From inside the panel: go one level deeper (Back returns).
  openPanel({ kind: "simplify", ...rest }, !inPanel);
};
// Right under Submit: which path the next answer takes, and the switch to change it.
function aiStatusHtml() {
  if (!auth) return `<span class="dot off"></span><span><b>AI mentor off.</b> You'll see the built-in answer instead of feedback on your own design.
    <button class="link" type="button" id="aiSignIn">Sign in to turn it on</button> — any username and PIN, free.</span>`;
  if ((auth.remaining ?? 1) <= 0) return `<span class="dot off"></span><span><b>AI mentor: no replies left today.</b> You'll see the built-in answer until tomorrow.</span>`;
  return `<label class="toggle"><input type="checkbox" id="aiToggleInline" ${state.aiOn ? "checked" : ""}>
    <span><b>AI mentor ${state.aiOn ? "on" : "off"}</b> — ${state.aiOn ? `feedback on your own design (${auth.remaining ?? "–"} of ${freeDaily} replies left today)` : "you'll see the built-in answer instead"}</span></label>`;
}
function bindAiStatus(sys) {
  const t = $("aiToggleInline");
  if (t) t.onchange = (e) => { state.aiOn = e.target.checked; save(); refresh(sys); };
  const si = $("aiSignIn");
  if (si) si.onclick = () => { const u = $("uName"); u?.scrollIntoView({ behavior: "smooth", block: "center" }); u?.focus(); };
}
function refresh(sys) {
  const v = currentView();
  renderPath(v); renderAccount();
  if (v.type === "sys" && v.id === sys.id) renderSession(sys);
}
function push(sys, entry) { session(sys).thread.push(entry); save(); }
function setBusy(on, label) {
  busy = on;
  ["submitBtn", "hintBtn", "explainBtn", "revealBtn"].forEach((id) => { const b = $(id); if (b) b.disabled = on; });
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
    if (e.type === "explain") return `Mentor (explained layer ${e.layer + 1} to the learner in full — they may now paraphrase it; check they understood the mechanism)`;
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
  try { FIELDS = await (await fetch("/fields.json")).json(); } catch { FIELDS = [{ id: "mechanical", name: "Mechanical", suggestions: [] }]; }
  if (!FIELDS.some((f) => f.id === state.field)) state.field = "mechanical";
  try { freeDaily = (await (await fetch("/api/config")).json()).freeDaily ?? 5; } catch {}
  renderAll(false);
  fillAds();
  if (auth) {
    try {
      const me = await api("/api/me");
      auth.remaining = me.remaining; writeLS("ga-auth", auth);
      const p = await api("/api/progress");
      mergeProgress(p.data);
      writeLS("ga-state", state);
      renderAll(false);
    } catch {}
  }
})();
