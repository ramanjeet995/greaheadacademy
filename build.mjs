// Builds the static site into dist/:
//  - copies public/
//  - adds AdSense tags (from env vars) to every HTML page
//  - generates a crawlable page per system at /s/<id>/, plus sitemap.xml, robots.txt, ads.txt and 404.html
// No dependencies — runs with plain Node. Netlify runs it on every deploy.
import fs from "node:fs";
import path from "node:path";

const SRC = "public", OUT = "dist";
const env = process.env;
const SITE = (env.SITE_URL || env.URL || "").replace(/\/$/, ""); // Netlify sets URL during builds
const ADSENSE_CLIENT = env.ADSENSE_CLIENT || "";
const SLOTS = { top: env.AD_SLOT_TOP || "", side: env.AD_SLOT_SIDE || "", bottom: env.AD_SLOT_BOTTOM || "" };
const LEVELS = ["Student", "Junior", "Mid-level", "Senior", "Modern"];
const FIELDS = JSON.parse(fs.readFileSync(path.join(SRC, "fields.json"), "utf8"));
const FIELD_NAME = Object.fromEntries(FIELDS.map((f) => [f.id, f.name]));

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const systems = JSON.parse(fs.readFileSync(path.join(SRC, "systems.json"), "utf8"));

fs.rmSync(OUT, { recursive: true, force: true });
fs.cpSync(SRC, OUT, { recursive: true });

function render(html, { title, description, canonical, article, appendArticle }) {
  const head = [];
  if (ADSENSE_CLIENT) {
    head.push(`<meta name="google-adsense-account" content="${esc(ADSENSE_CLIENT)}">`);
    head.push(`<script async src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${esc(ADSENSE_CLIENT)}" crossorigin="anonymous"></script>`);
  }
  head.push(`<script>window.GA_ADS=${JSON.stringify({ client: ADSENSE_CLIENT, slots: SLOTS }).replace(/</g, "\\u003c")};</script>`);
  if (canonical && SITE) head.push(`<link rel="canonical" href="${esc(SITE + canonical)}">`);
  html = html.replace("<!--HEAD-->", head.join("\n"));
  if (title) html = html.replace(/<title>[^<]*<\/title>/, `<title>${esc(title)}</title>`);
  if (description) html = html.replace(/<meta name="description" content="[^"]*">/, `<meta name="description" content="${esc(description)}">`);
  if (article) html = html.replace(/<!--SSR-->[\s\S]*?<!--\/SSR-->/, article);
  if (appendArticle) html = html.replace("<!--/SSR-->", appendArticle + "<!--/SSR-->");
  return html;
}

const shell = fs.readFileSync(path.join(SRC, "index.html"), "utf8");
const write = (file, content) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, content); };

// Home.
write(path.join(OUT, "index.html"), render(shell, { canonical: "/" }));

// Other static pages.
for (const page of ["about.html", "privacy.html"]) {
  const html = fs.readFileSync(path.join(SRC, page), "utf8");
  write(path.join(OUT, page), render(html, { canonical: `/${page}` }));
}

// One page per system.
for (const sys of systems) {
  const article = `<article class="ssr">
  <p class="eyebrow">${esc(FIELD_NAME[sys.field] || "")} · ${esc(sys.era || "")}</p>
  <h2>How does a ${esc(sys.title.toLowerCase())} work?</h2>
  <p>${esc(sys.prompt)}</p>
  <h3>The five layers</h3>
  <ol>${sys.layers.map((l, i) => `<li><strong>${LEVELS[i] || ""} — ${esc(l.name)}.</strong> ${i ? esc(l.ask) : ""}</li>`).join("")}</ol>
  <details><summary>Reference notes: how real designs do it (spoilers)</summary>
  ${sys.layers.map((l, i) => `<h4>Layer ${i + 1} · ${esc(l.name)}</h4><p>${esc(l.real)}</p>`).join("")}
  </details>
</article>`;
  write(path.join(OUT, "s", sys.id, "index.html"), render(shell, {
    title: `How a ${sys.title} works — Gearhead Academy`,
    description: `Design a ${sys.title.toLowerCase()} yourself, layer by layer, from the basic idea to modern engineering. ${sys.prompt}`.slice(0, 300),
    canonical: `/s/${sys.id}`,
    article,
  }));
}

// 404: the app shell shows the home view for unknown paths.
write(path.join(OUT, "404.html"), render(shell, { title: "Page not found — Gearhead Academy" }));

// Sitemap, robots, ads.txt.
const urls = ["/", "/about.html", "/privacy.html", ...systems.map((s) => `/s/${s.id}`)];
if (SITE) {
  write(path.join(OUT, "sitemap.xml"), `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls.map((u) => `<url><loc>${esc(SITE + u)}</loc></url>`).join("")}</urlset>\n`);
} else {
  console.warn("SITE_URL/URL not set — skipping sitemap.xml (Netlify sets URL automatically on deploy).");
}
write(path.join(OUT, "robots.txt"), `User-agent: *\nDisallow: /api/\n${SITE ? `Sitemap: ${SITE}/sitemap.xml\n` : ""}`);
const pub = ADSENSE_CLIENT.replace(/^ca-/, "");
write(path.join(OUT, "ads.txt"), pub ? `google.com, ${pub}, DIRECT, f08c47fec0942fa0\n` : "# Set ADSENSE_CLIENT to publish ads.txt\n");

console.log(`Built ${systems.length} system pages into ${OUT}/${ADSENSE_CLIENT ? " with AdSense" : ""}.`);
