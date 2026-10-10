const $ = (s) => document.querySelector(s);
const DEFAULTS = {
  apiKey: "",
  model: "gemini-2.5-flash",
  v: 3,
  titleMin: 45,
  titleMax: 75,
  descMin: 200,
  descMax: 1000,
  tagMax: 20,
  tagCount: 10,
  fieldCount: 3,
  imgTagMin: 3,
  imgTagMax: 7,
  lang: "English",
  maxImages: 300,
  batchSize: 40,
  imgEdge: 448,
};
let settings = { ...DEFAULTS };
let result = null; // { titles, title, tags, description, candidates }
let analysis = null; // { subject, creativeField, designTypes, style, seeds, imageCount }

/* ---------- helpers ---------- */
function toast(msg, ms = 2200) {
  const t = $("#toast");
  t.textContent = msg;
  t.classList.add("show");
  clearTimeout(toast._t);
  toast._t = setTimeout(() => t.classList.remove("show"), ms);
}
const store = {
  get: (k) => new Promise((r) => chrome.storage.local.get(k, r)),
  set: (o) => new Promise((r) => chrome.storage.local.set(o, r)),
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function setStep(n, state) {
  const li = document.querySelector(`.steps li[data-step="${n}"]`);
  if (!li) return;
  li.classList.remove("active", "done", "fail");
  if (state) li.classList.add(state);
}
function say(text) {
  $("#status").textContent = text;
}
function clampWords(text, max) {
  text = (text || "").replace(/\s+/g, " ").trim();
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  const sp = cut.lastIndexOf(" ");
  return (sp > max * 0.6 ? cut.slice(0, sp) : cut).replace(/[\s,:;|-]+$/, "");
}

/* ---------- settings ---------- */
async function loadSettings() {
  const s = await store.get(["settings"]);
  const saved = s.settings || {};
  settings = { ...DEFAULTS, ...saved };
  if ((saved.v || 1) < 3) {
    // move older saved limits to the current defaults (tag max 20, normal-length titles)
    settings.titleMin = DEFAULTS.titleMin;
    settings.titleMax = DEFAULTS.titleMax;
    settings.descMin = DEFAULTS.descMin;
    settings.descMax = DEFAULTS.descMax;
    settings.tagMax = DEFAULTS.tagMax;
    settings.v = 3;
    await store.set({ settings });
  }
  $("#apiKey").value = settings.apiKey;
  $("#model").value = settings.model;
  $("#titleMin").value = settings.titleMin;
  $("#titleMax").value = settings.titleMax;
  $("#descMin").value = settings.descMin;
  $("#descMax").value = settings.descMax;
  $("#tagMax").value = settings.tagMax;
  $("#tagCount").value = settings.tagCount;
  $("#fieldCount").value = settings.fieldCount;
  $("#imgTagMin").value = settings.imgTagMin;
  $("#imgTagMax").value = settings.imgTagMax;
  $("#lang").value = settings.lang;
  $("#maxImages").value = settings.maxImages;
  $("#batchSize").value = settings.batchSize;
  $("#imgEdge").value = settings.imgEdge;
  if (!settings.apiKey) $("#settings").classList.remove("hidden");
}
$("#btnSettings").onclick = () => $("#settings").classList.toggle("hidden");
$("#btnSave").onclick = async () => {
  settings = {
    apiKey: $("#apiKey").value.trim(),
    model: $("#model").value.trim() || DEFAULTS.model,
    v: 3,
    titleMax: Math.max(20, +$("#titleMax").value || DEFAULTS.titleMax),
    titleMin: Math.min(Math.max(10, +$("#titleMin").value || DEFAULTS.titleMin), Math.max(20, +$("#titleMax").value || DEFAULTS.titleMax)),
    descMax: Math.max(100, +$("#descMax").value || DEFAULTS.descMax),
    descMin: Math.min(Math.max(0, +$("#descMin").value || 0), Math.max(100, +$("#descMax").value || DEFAULTS.descMax)),
    tagMax: Math.min(25, Math.max(5, +$("#tagMax").value || DEFAULTS.tagMax)),
    tagCount: Math.min(10, Math.max(3, +$("#tagCount").value || DEFAULTS.tagCount)),
    fieldCount: Math.min(3, Math.max(1, +$("#fieldCount").value || DEFAULTS.fieldCount)),
    imgTagMax: Math.min(7, Math.max(1, +$("#imgTagMax").value || DEFAULTS.imgTagMax)),
    imgTagMin: Math.min(7, Math.min(Math.max(1, +$("#imgTagMin").value || DEFAULTS.imgTagMin), Math.max(1, +$("#imgTagMax").value || DEFAULTS.imgTagMax))),
    lang: $("#lang").value.trim() || DEFAULTS.lang,
    maxImages: Math.min(600, Math.max(10, +$("#maxImages").value || DEFAULTS.maxImages)),
    batchSize: Math.min(80, Math.max(10, +$("#batchSize").value || DEFAULTS.batchSize)),
    imgEdge: Math.min(1024, Math.max(256, +$("#imgEdge").value || DEFAULTS.imgEdge)),
  };
  await store.set({ settings });
  $("#settings").classList.add("hidden");
  toast("Settings saved ✅");
};

/* ---------- talking to the Behance tab ---------- */
async function activeBehanceTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || !/^https:\/\/([\w-]+\.)?behance\.net\//.test(tab.url || "")) {
    throw new Error("Open your Behance project (editor or project page) in the active tab first.");
  }
  return tab;
}
async function sendToTab(msg) {
  const tab = await activeBehanceTab();
  try {
    return await chrome.tabs.sendMessage(tab.id, msg);
  } catch (e) {
    // content script not injected yet (tab opened before install) → inject and retry
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ["content.js"] });
    return await chrome.tabs.sendMessage(tab.id, msg);
  }
}

/* ---------- collect every project image ---------- */
async function urlToJpeg(url, edge) {
  const r = await fetch(url);
  if (!r.ok) throw new Error("http " + r.status);
  const bmp = await createImageBitmap(await r.blob());
  const scale = Math.min(1, edge / Math.max(bmp.width, bmp.height));
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.round(bmp.width * scale));
  c.height = Math.max(1, Math.round(bmp.height * scale));
  c.getContext("2d").drawImage(bmp, 0, 0, c.width, c.height);
  return c.toDataURL("image/jpeg", 0.65);
}
async function collectProjectImages() {
  const res = await sendToTab({ type: "GRAB_IMAGES", maxImages: settings.maxImages, edge: settings.imgEdge });
  if (res && res.error) throw new Error(res.error);
  const items = (res && res.items) || [];
  const pending = items.map((it, i) => ({ it, i })).filter((x) => !x.it.dataUrl && x.it.url);
  let done = 0;
  let idx = 0;
  async function worker() {
    while (idx < pending.length) {
      const p = pending[idx++];
      try {
        p.it.dataUrl = await urlToJpeg(p.it.url, settings.imgEdge);
      } catch {}
      done++;
      say(`Downloading images… ${done}/${pending.length}`);
    }
  }
  if (pending.length) await Promise.all(Array.from({ length: 6 }, worker));
  const images = items.map((x) => x.dataUrl).filter(Boolean);
  return { images, found: (res && res.totalFound) || items.length };
}

/* ---------- Gemini ---------- */
async function gemini(promptText, dataUrls = []) {
  if (!settings.apiKey) throw new Error("Add your Gemini API key in Settings ⚙️");
  const parts = [{ text: promptText }];
  for (const d of dataUrls) parts.push({ inline_data: { mime_type: "image/jpeg", data: d.split(",")[1] } });
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(settings.model)}:generateContent`;
  let lastErr;
  for (let attempt = 0; attempt < 4; attempt++) {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": settings.apiKey },
      body: JSON.stringify({
        contents: [{ role: "user", parts }],
        generationConfig: { responseMimeType: "application/json", temperature: 0.4 },
      }),
    });
    if (res.status === 429 || res.status >= 500) {
      lastErr = new Error(`Gemini ${res.status} (busy / rate limit)`);
      await sleep(4000 * (attempt + 1));
      continue;
    }
    if (!res.ok) {
      const t = await res.text();
      throw new Error(`Gemini ${res.status}: ${t.slice(0, 180)}`);
    }
    const data = await res.json();
    const text = data?.candidates?.[0]?.content?.parts?.map((p) => p.text || "").join("") || "";
    try {
      return JSON.parse(text);
    } catch {
      const m = text.match(/\{[\s\S]*\}/);
      if (m) return JSON.parse(m[0]);
      throw new Error("Gemini returned unreadable JSON");
    }
  }
  throw lastErr || new Error("Gemini failed");
}

/* ---------- keyword research (real search signals) ---------- */
async function googleSuggest(q) {
  try {
    const r = await fetch(`https://suggestqueries.google.com/complete/search?client=firefox&q=${encodeURIComponent(q)}`);
    const j = await r.json();
    return Array.isArray(j[1]) ? j[1] : [];
  } catch {
    return [];
  }
}
// Best-effort: read the public Behance search page and count tags / project names that appear.
async function behanceMine(q) {
  const out = { tags: [], names: [] };
  try {
    const r = await fetch(`https://www.behance.net/search/projects?search=${encodeURIComponent(q)}`, { credentials: "include" });
    if (!r.ok) return out;
    const html = await r.text();
    const tagBlocks = html.match(/"tags":\[[^\]]{0,600}\]/g) || [];
    for (const blk of tagBlocks) {
      const titles = [...blk.matchAll(/"(?:title|name)":"([^"]{2,40})"/g)].map((m) => m[1]);
      if (titles.length) out.tags.push(...titles);
      else out.tags.push(...[...blk.matchAll(/"([^"]{2,40})"/g)].map((m) => m[1]).filter((x) => x !== "tags"));
    }
    out.names = [...html.matchAll(/"name":"([^"]{6,80})"/g)].map((m) => m[1]).slice(0, 12);
  } catch {}
  return out;
}
function cleanKw(s) {
  return s
    .replace(/\\u[\dA-Fa-f]{4}/g, "")
    .replace(/[^\p{L}\p{N}\s&'+-]/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}
async function collectKeywords(seeds) {
  const map = new Map();
  const names = [];
  let behanceOk = false;
  const bump = (kw, key, w = 1) => {
    kw = cleanKw(kw);
    if (!kw || kw.length < 3 || kw.length > 40 || kw.split(" ").length > 5) return;
    const o = map.get(kw) || { kw, g: 0, b: 0, seed: 0 };
    o[key] += w;
    map.set(kw, o);
  };
  await Promise.all(
    seeds.slice(0, 8).map(async (seed) => {
      bump(seed, "seed", 1);
      const [g1, g2, b] = await Promise.all([googleSuggest(seed), googleSuggest(seed + " design"), behanceMine(seed)]);
      [...g1, ...g2].forEach((k) => bump(k, "g"));
      b.tags.forEach((k) => bump(k, "b"));
      if (b.tags.length || b.names.length) behanceOk = true;
      names.push(...b.names);
    })
  );
  const list = [...map.values()]
    .map((o) => ({ ...o, score: o.g * 2 + o.b * 3 + o.seed * 5 }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 60);
  return { list, names: [...new Set(names)].slice(0, 10), behanceOk };
}

/* ---------- hard validators (Behance limits) ---------- */
// Behance rejects tags over 25 chars or containing < >. We never send such tags.
function sanitizeText(s) {
  return String(s || "")
    .replace(/[<>]/g, " ")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
function sanitizeTag(s) {
  return cleanKw(String(s || "")).replace(/^[-+&']+|[-+&']+$/g, "").trim();
}
function clampDesc(t, max) {
  if (t.length <= max) return t;
  const cut = t.slice(0, max);
  const i = cut.lastIndexOf(".");
  return i > max * 0.6 ? cut.slice(0, i + 1) : clampWords(t, max);
}
function fixTags(tags, candidates) {
  const max = settings.tagMax;
  const want = settings.tagCount;
  const out = [];
  const seen = new Set();
  const add = (t) => {
    t = sanitizeTag(t);
    if (!t || t.length > max || t.split(" ").length > 3) return;
    const k = t.replace(/s$/, "");
    if (seen.has(k)) return;
    seen.add(k);
    out.push(t);
  };
  (tags || []).forEach(add);
  for (const c of candidates || []) {
    if (out.length >= want) break;
    add(c.kw);
  }
  return out.slice(0, want);
}
// Titles that read like a keyword list instead of a real project title.
function looksStuffed(t) {
  const words = t.toLowerCase().split(/\s+/).filter(Boolean);
  const counts = {};
  words.forEach((w) => {
    if (w.length > 3) counts[w] = (counts[w] || 0) + 1;
  });
  return words.length < 4 || (t.match(/,/g) || []).length >= 2 || /\|/.test(t) || Object.values(counts).some((c) => c > 2);
}
// Names are examples; the editor's own dropdown decides what exists, the content script matches by name.
const COMMON_FIELDS = [
  "Graphic Design", "Illustration", "UI/UX", "Branding", "Packaging", "Logo Design", "Typography", "Advertising",
  "Art Direction", "Photography", "Motion Graphics", "Animation", "3D Art", "Digital Art", "Icon Design",
  "Print Design", "Web Design", "Product Design", "Fashion", "Interaction Design", "Character Design", "Drawing",
];
function fixFields(list) {
  const out = [];
  const seen = new Set();
  for (const f of list || []) {
    let t = sanitizeText(f);
    if (!t) continue;
    const canon = COMMON_FIELDS.find((c) => c.toLowerCase() === t.toLowerCase());
    t = canon || t;
    if (t.length > 40 || seen.has(t.toLowerCase())) continue;
    seen.add(t.toLowerCase());
    out.push(t);
  }
  return out.slice(0, settings.fieldCount);
}
function validateCopy(out, candidates) {
  const issues = [];
  const tMin = settings.titleMin;
  const tMax = settings.titleMax;
  const all = (out.titles || []).map(sanitizeText).filter(Boolean).map((t) => (t.length > tMax ? clampWords(t, tMax) : t));
  const okTitles = all.filter((t) => t.length >= tMin && !looksStuffed(t));
  if (!okTitles.length) issues.push(`title shorter than ${tMin} characters`);
  let description = sanitizeText(out.description);
  description = clampDesc(description, settings.descMax);
  if (description.length < settings.descMin) issues.push(`description shorter than ${settings.descMin} characters`);
  const tags = fixTags(out.tags, candidates);
  if (tags.length < settings.tagCount) issues.push(`only ${tags.length} valid tags found`);
  return { titles: okTitles.length ? okTitles : all, tags, description, issues };
}
// Read the real field limits from the open Behance editor (maxlength attributes), if visible.
async function applyLiveLimits() {
  try {
    const r = await sendToTab({ type: "GET_LIMITS" });
    if (!r) return;
    if (r.titleMax) settings.titleMax = Math.min(settings.titleMax, r.titleMax);
    if (r.descMax) settings.descMax = Math.min(settings.descMax, r.descMax);
    if (r.tagMax) settings.tagMax = Math.min(settings.tagMax, r.tagMax);
    if (settings.titleMin > settings.titleMax) settings.titleMin = Math.max(10, settings.titleMax - 15);
    if (settings.descMin > settings.descMax) settings.descMin = Math.floor(settings.descMax / 2);
  } catch {}
}

/* ---------- prompts ---------- */
function batchPrompt(k, n, brand, brief) {
  return `These images are part ${k} of ${n} of ONE Behance design project (in page order). Together they form a single project, so describe what they show, do not treat them as separate works.
Project/brand name given by the designer: ${brand || "(none)"}. Brief: ${brief || "(none)"}.
Return JSON only, short phrases, no sentences: {"subjects": ["what is designed"], "designTypes": ["e.g. label design, packaging, logo, social media post"], "mockupsOrProducts": ["e.g. can, bottle, box, poster"], "style": ["visual style words"], "dominantColors": ["..."], "visibleText": ["brand or product names / readable text seen in the images"], "industryOrAudience": ["..."]}`;
}
function mergePrompt(batches, brand, brief, count) {
  return `You are a Behance SEO researcher. Below are summaries of ALL ${count} images of one project, analysed in ${batches.length} batches. Merge them into one understanding of the whole project (weigh what appears most often).
Project/brand name given by the designer: ${brand || "(none)"}. Brief: ${brief || "(none)"}.
BATCH SUMMARIES:
${JSON.stringify(batches).slice(0, 12000)}

Return JSON only: {"subject": "<one sentence about the whole project>", "creativeField": "<one Behance creative field>", "designTypes": ["..."], "style": ["..."], "brandName": "<main brand/project name if clearly shown, else empty>", "seeds": ["<5-8 short search phrases (1-3 words each) a client or designer would really type into Behance search to find this project, most specific first>"]}`;
}
function finalPrompt(brief, brand, a, kw) {
  const lines = kw.list.map((o) => `${o.kw} | G${o.g} B${o.b}`).join("\n");
  const examples = kw.names.length ? `Titles of projects that currently rank for these searches (for pattern only, never copy):\n${kw.names.join("\n")}\n` : "";
  return `You are a senior Behance SEO specialist. Write the metadata for this ONE project, based on all of its images.
Project: ${a.subject}
Design types: ${(a.designTypes || []).join(", ")}. Style: ${(a.style || []).join(", ")}. Creative field: ${a.creativeField || ""}.
Brand/project name: ${brand || a.brandName || "(none)"}. Brief: ${brief || "(none)"}.
Language: ${settings.lang}

CANDIDATE KEYWORDS (real search signals; G = Google autocomplete hits, B = appearances in Behance results). Pick from these. Do not invent random keywords:
${lines}

${examples}
RULES
- Title: BETWEEN ${settings.titleMin} and ${settings.titleMax} characters (aim for ${Math.max(settings.titleMin, settings.titleMax - 15)}-${settings.titleMax}), 5-10 words. It must read like a real project title a human designer would write: a clear project/brand name or concept, then what it is, optionally after a dash or colon, e.g. "NOIRÉ Energy Drink — Label and Can Packaging Design" or "Minimal Coffee Brand Identity and Packaging Design". Natural Title Case, sensible and easy to read, NOT a list of keywords, NOT a short two or three word title, NOT shorter than ${settings.titleMin} characters. Use the main search keyword naturally inside it. No emojis, no pipes, no < or > characters, no keyword stuffing. You may include the project's own brand name once; never use third-party trademarks.
- Give 3 title options with different angles, all within the length range.
- Tags: exactly ${settings.tagCount}, ordered by importance, 1-3 words each, EACH TAG MAX ${settings.tagMax} CHARACTERS INCLUDING SPACES, only letters, numbers, spaces and hyphens, never < or >, no commas. Mostly taken from the candidates. Include 1-2 broad tags (e.g. a creative field) and the rest specific. No duplicates or plural/singular repeats.
- Description: BETWEEN ${settings.descMin} and ${settings.descMax} characters (aim for about ${Math.min(settings.descMax, Math.max(settings.descMin, 600))}), 3-5 natural sentences, primary keyword in the first sentence, then what the project contains, the style, deliverables and where it can be used. No < or > characters, no hashtags, no keyword lists.
- Creative fields: choose up to ${settings.fieldCount} Behance Creative Fields (the category of the work), most relevant first, e.g. Illustration, Graphic Design, UI/UX, Branding, Packaging. Prefer names from this list: ${COMMON_FIELDS.join(", ")}.
Return JSON only: {"primaryKeyword": "", "titles": ["", "", ""], "tags": [""], "description": "", "creativeFields": [""]}`;
}

function repairPrompt(out, issues) {
  return `Fix this Behance project metadata. Problems found: ${issues.join("; ")}.
Current JSON: ${JSON.stringify(out)}
Rules: every title must be BETWEEN ${settings.titleMin} and ${settings.titleMax} characters (aim for ${Math.max(settings.titleMin, settings.titleMax - 15)}-${settings.titleMax}), 5-10 words, starting with the primary keyword and describing what the project is. The description must be BETWEEN ${settings.descMin} and ${settings.descMax} characters, 3-5 natural sentences. No < or > characters. Keep the tags unchanged. Language: ${settings.lang}.
Return JSON only in the same shape: {"primaryKeyword": "", "titles": ["", "", ""], "tags": [""], "description": ""}`;
}

/* ---------- analyze whole project ---------- */
async function analyzeProject(brand, brief) {
  setStep(1, "active");
  say("Scrolling the page and collecting images…");
  const { images, found } = await collectProjectImages();
  if (!images.length) {
    throw new Error("No readable project images found. Scroll to the project content in the editor and try again.");
  }
  setStep(1, "done");
  say(`Collected ${images.length} image(s) (${found} found on the page).`);

  setStep(2, "active");
  const size = settings.batchSize;
  const n = Math.ceil(images.length / size);
  const batches = [];
  for (let k = 0; k < n; k++) {
    say(`Analyzing images… batch ${k + 1}/${n} (${images.length} images total)`);
    const chunk = images.slice(k * size, (k + 1) * size);
    batches.push(await gemini(batchPrompt(k + 1, n, brand, brief), chunk));
  }
  say("Merging everything into one project understanding…");
  const merged = await gemini(mergePrompt(batches, brand, brief, images.length));
  setStep(2, "done");
  const seeds = (merged.seeds || []).map(String).filter(Boolean);
  if (!seeds.length) throw new Error("No seed keywords came back, try adding a brief");
  return { ...merged, seeds, imageCount: images.length };
}

/* ---------- generate ---------- */
let busy = false;
async function generate(reuse) {
  if (busy) return;
  busy = true;
  $("#btnGen").disabled = true;
  $("#progress").classList.remove("hidden");
  $("#result").classList.add("hidden");
  [1, 2, 3, 4].forEach((n) => setStep(n, null));
  const brand = $("#brand").value.trim();
  const brief = $("#brief").value.trim();
  let stage = 1;
  try {
    if (reuse && analysis) {
      setStep(1, "done");
      setStep(2, "done");
    } else {
      analysis = await analyzeProject(brand, brief);
      await store.set({ lastAnalysis: analysis });
    }

    stage = 3;
    setStep(3, "active");
    say("Seeds: " + analysis.seeds.join(", "));
    const kw = await collectKeywords(analysis.seeds);
    if (!kw.list.length) throw new Error("Keyword research returned nothing (network?)");
    setStep(3, "done");
    say(kw.behanceOk ? "Used Google suggestions + Behance search results." : "Behance search page was not readable, so only Google suggestions were used.");

    stage = 4;
    setStep(4, "active");
    await applyLiveLimits();
    let out = await gemini(finalPrompt(brief, brand, analysis, kw));
    let fixed = validateCopy(out, kw.list);
    if (fixed.issues.some((i) => /title|description/.test(i))) {
      say("Fixing length problems: " + fixed.issues.join("; "));
      try {
        const out2 = await gemini(repairPrompt(out, fixed.issues));
        out = { ...out2, tags: out2.tags && out2.tags.length ? out2.tags : out.tags, creativeFields: out.creativeFields };
        fixed = validateCopy(out, kw.list);
      } catch {}
    }
    setStep(4, "done");
    result = {
      titles: fixed.titles.length ? fixed.titles : [sanitizeText(out.primaryKeyword || analysis.seeds[0])],
      title: fixed.titles[0] || "",
      tags: fixed.tags,
      fields: fixFields(out.creativeFields),
      description: fixed.description,
      candidates: kw.list,
    };
    if (fixed.issues.length) toast("Note: " + fixed.issues.join("; "), 5000);
    renderResult();
    await store.set({ lastResult: result });
  } catch (e) {
    setStep(stage, "fail");
    say("❌ " + e.message);
    toast(e.message, 4000);
  } finally {
    busy = false;
    $("#btnGen").disabled = false;
  }
}
$("#btnGen").onclick = () => generate(false);
$("#btnRegen").onclick = () => generate(true);

/* ---------- result UI ---------- */
function updateCounts() {
  const t = $("#titleInput").value.length;
  const d = $("#descInput").value.length;
  $("#titleCount").textContent = `${t} (allowed ${settings.titleMin}-${settings.titleMax})`;
  $("#titleCount").classList.toggle("bad", t > settings.titleMax || t < settings.titleMin);
  $("#descCount").textContent = `${d} (allowed ${settings.descMin}-${settings.descMax})`;
  $("#descCount").classList.toggle("bad", d > settings.descMax || d < settings.descMin);
  $("#tagsCount").textContent = `${result.tags.length}/10`;
  $("#tagsCount").classList.toggle("bad", result.tags.length > 10);
}
function renderTags() {
  const box = $("#tagChips");
  box.innerHTML = "";
  result.tags.forEach((t, i) => {
    const c = document.createElement("span");
    c.className = "chip";
    c.innerHTML = `<span></span><button title="Remove">×</button>`;
    c.firstChild.textContent = t;
    c.querySelector("button").onclick = () => {
      result.tags.splice(i, 1);
      renderTags();
    };
    box.appendChild(c);
  });
  updateCounts();
}
function renderFields() {
  result.fields = result.fields || [];
  const box = $("#fieldChips");
  box.innerHTML = "";
  result.fields.forEach((f, i) => {
    const c = document.createElement("span");
    c.className = "chip";
    c.innerHTML = `<span></span><button title="Remove">×</button>`;
    c.firstChild.textContent = f;
    c.querySelector("button").onclick = () => {
      result.fields.splice(i, 1);
      renderFields();
    };
    box.appendChild(c);
  });
  $("#fieldsCount").textContent = `${result.fields.length}/${settings.fieldCount}`;
}
$("#fieldAdd").onkeydown = (e) => {
  if (e.key !== "Enter") return;
  e.preventDefault();
  const v = sanitizeText(e.target.value);
  if (v && result) {
    result.fields = fixFields([...(result.fields || []), v]);
    renderFields();
  }
  e.target.value = "";
};

function renderResult() {
  $("#result").classList.remove("hidden");
  const opts = $("#titleOptions");
  opts.innerHTML = "";
  result.titles.forEach((t) => {
    const c = document.createElement("span");
    c.className = "chip opt" + (t === result.title ? " sel" : "");
    c.textContent = t;
    c.onclick = () => {
      result.title = t;
      $("#titleInput").value = t;
      [...opts.children].forEach((x) => x.classList.toggle("sel", x === c));
      updateCounts();
    };
    opts.appendChild(c);
  });
  $("#titleInput").value = result.title;
  $("#descInput").value = result.description;
  renderTags();
  renderFields();
  if (analysis) {
    $("#analysisText").textContent =
      `${analysis.imageCount || "?"} images analysed. ${analysis.subject || ""} ` +
      `Types: ${(analysis.designTypes || []).join(", ")}. Style: ${(analysis.style || []).join(", ")}.`;
  }
  const rs = $("#research");
  rs.innerHTML = "";
  result.candidates.slice(0, 40).forEach((o) => {
    const c = document.createElement("span");
    c.className = "chip";
    const dots = (o.g ? '<span class="dot g"></span>' : "") + (o.b ? '<span class="dot b"></span>' : "");
    c.innerHTML = dots + "<span></span>";
    c.lastChild.textContent = o.kw;
    rs.appendChild(c);
  });
  $("#fillReport").textContent = "";
  $("#result").scrollIntoView({ behavior: "smooth" });
}
$("#titleInput").oninput = () => { result.title = $("#titleInput").value; updateCounts(); };
$("#descInput").oninput = () => { result.description = $("#descInput").value; updateCounts(); };
$("#tagAdd").onkeydown = (e) => {
  if (e.key !== "Enter") return;
  e.preventDefault();
  const v = sanitizeTag(e.target.value);
  if (v && v.length > settings.tagMax) {
    toast(`Tag too long: Behance allows ${settings.tagMax} characters max`);
    return;
  }
  if (v && !result.tags.includes(v) && result.tags.length < settings.tagCount) {
    result.tags.push(v);
    renderTags();
  }
  e.target.value = "";
};
document.querySelectorAll("[data-copy]").forEach((b) => {
  b.onclick = async () => {
    const k = b.dataset.copy;
    const text = k === "title" ? result.title : k === "tags" ? result.tags.join(", ") : result.description;
    await navigator.clipboard.writeText(text);
    toast("Copied ✅");
  };
});

/* ---------- fill / publish ---------- */
$("#btnFill").onclick = async () => {
  if (!result) return;
  $("#fillReport").textContent = "Filling…";
  try {
    const res = await sendToTab({
      type: "FILL",
      payload: {
        title: sanitizeText(result.title),
        tags: fixTags(result.tags, []),
        description: sanitizeText(result.description),
        tagMax: settings.tagMax,
        fields: result.fields || [],
        fieldCount: settings.fieldCount,
        replaceOld: $("#replaceOld").checked,
      },
    });
    const r = res || {};
    const mark = (ok) => (ok ? "✅" : "⚠️ not found");
    const fieldsMark = !(result.fields || []).length ? "—" : r.fieldsCount ? `✅ ${r.fieldsCount}` : "⚠️ not found (open Creative Fields in Settings)";
    let report = `Title ${mark(r.title)} · Tags ${mark(r.tags)} · Description ${mark(r.description)} · Fields ${fieldsMark}` +
      (r.title && r.tags && r.description ? "" : "  → Open the project Settings drawer in the editor, then press Fill again (or use the Copy buttons).");
    const errs = r.errors || [];
    if (errs.length) {
      const joined = errs.join(" | ");
      report += `\n⚠️ Behance says: ${joined}`;
      // learn the real limit from Behance's own message and fix the tags right away
      const m = joined.match(/limited to (\d+) characters/i);
      if (m && /tag/i.test(joined)) {
        settings.tagMax = Math.min(settings.tagMax, +m[1]);
        await store.set({ settings });
        result.tags = fixTags(result.tags, result.candidates);
        renderTags();
        report += `\nTag limit learned: ${settings.tagMax} characters. Tags were re-checked, press Fill again.`;
      }
    }
    $("#fillReport").style.whiteSpace = "pre-line";
    $("#fillReport").textContent = report;
  } catch (e) {
    $("#fillReport").textContent = "❌ " + e.message;
  }
};
$("#btnPublish").onclick = async () => {
  if (!confirm("Click Behance's Publish button now? Check the preview first.")) return;
  try {
    const res = await sendToTab({ type: "PUBLISH" });
    toast(res && res.clicked ? "Publish clicked 🚀" : "Publish button not found");
  } catch (e) {
    toast(e.message, 3500);
  }
};

/* ---------- per-image tags ---------- */
function buildVocab() {
  const parts = [];
  if (analysis) {
    parts.push(analysis.subject, analysis.creativeField, ...(analysis.seeds || []), ...(analysis.designTypes || []), ...(analysis.style || []));
  }
  if (result) parts.push(result.title, ...(result.tags || []), ...(result.fields || []));
  parts.push($("#brief").value, $("#brand").value);
  const words = new Set();
  parts
    .filter(Boolean)
    .join(" ")
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .forEach((w) => {
      if (w.length >= 3) words.add(w);
    });
  return [...words];
}
$("#btnImgTags").onclick = async () => {
  $("#imgTagStatus").textContent = "Starting… scrolling the editor and clicking each image.";
  try {
    const res = await sendToTab({
      type: "START_IMAGE_TAGS",
      payload: {
        vocab: buildVocab(),
        min: Math.min(7, settings.imgTagMin),
        max: Math.min(7, settings.imgTagMax),
        tagMax: settings.tagMax,
      },
    });
    if (res && res.started === false) $("#imgTagStatus").textContent = res.error || "Could not start.";
  } catch (e) {
    $("#imgTagStatus").textContent = "❌ " + e.message;
  }
};
$("#btnImgStop").onclick = async () => {
  try {
    await sendToTab({ type: "STOP_IMAGE_TAGS" });
    toast("Stopping after the current image…");
  } catch (e) {
    toast(e.message, 3000);
  }
};
$("#btnImgDebug").onclick = async () => {
  try {
    const res = await sendToTab({ type: "DEBUG_IMAGE_PANEL" });
    const text = res && res.html ? res.html : JSON.stringify(res || {}, null, 1);
    await navigator.clipboard.writeText(text);
    toast(res && res.html ? "Panel HTML copied. Paste it to Claude 📋" : "Nothing found, details copied 📋", 3500);
  } catch (e) {
    toast(e.message, 3500);
  }
};
chrome.runtime.onMessage.addListener((msg) => {
  if (!msg || msg.type !== "IMG_TAG_PROGRESS") return;
  const el = $("#imgTagStatus");
  if (msg.done) {
    el.textContent =
      (msg.error ? "❌ " + msg.error + "\n" : "") +
      `${msg.cancelled ? "Stopped. " : "Finished. "}Tagged ${msg.tagged} of ${msg.n} images, skipped ${msg.skipped}.`;
    return;
  }
  el.textContent = `Image ${msg.i}/${msg.n}: ` + ((msg.tags || []).length ? msg.tags.join(", ") : msg.note || "—");
});

/* ---------- init ---------- */
(async () => {
  await loadSettings();
  const s = await store.get(["lastResult", "lastAnalysis"]);
  if (s.lastAnalysis) analysis = s.lastAnalysis;
  if (s.lastResult) {
    result = s.lastResult;
    renderResult();
    $("#result").scrollIntoView({ behavior: "auto" });
  }
})();
