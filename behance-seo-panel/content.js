// Runs on behance.net pages. Collects all project images, fills the editor fields.
(() => {
  if (window.__beSeoLoaded) return;
  window.__beSeoLoaded = true;

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const visible = (el) => {
    const r = el.getBoundingClientRect();
    const st = getComputedStyle(el);
    return r.width > 0 && r.height > 0 && st.visibility !== "hidden" && st.display !== "none";
  };
  const attrText = (el) =>
    [
      el.getAttribute("placeholder"),
      el.getAttribute("aria-label"),
      el.getAttribute("name"),
      el.id,
      el.getAttribute("data-testid"),
      el.getAttribute("data-test"),
      el.className && String(el.className),
      el.closest("label") && el.closest("label").textContent,
      el.labels && el.labels[0] && el.labels[0].textContent,
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();

  /* ---------- fields ---------- */
  function findField(keywords, exclude = []) {
    const els = [...document.querySelectorAll('input[type="text"], input:not([type]), textarea, [contenteditable="true"], [role="textbox"]')];
    let best = null;
    let bestScore = 0;
    for (const el of els) {
      if (!visible(el)) continue;
      const t = attrText(el);
      if (/search/.test(t)) continue;
      if (exclude.some((x) => t.includes(x))) continue;
      let score = 0;
      keywords.forEach((k, i) => {
        if (t.includes(k)) score += 10 - i;
      });
      if (score > bestScore) {
        best = el;
        bestScore = score;
      }
    }
    return best;
  }

  function setText(el, value) {
    el.focus();
    if (el.tagName === "INPUT" || el.tagName === "TEXTAREA") {
      const proto = el.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(proto, "value").set.call(el, value);
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
    } else {
      const sel = window.getSelection();
      const range = document.createRange();
      range.selectNodeContents(el);
      sel.removeAllRanges();
      sel.addRange(range);
      document.execCommand("insertText", false, value);
    }
  }

  function pressKey(el, key, code, keyCode) {
    const init = { key, code, keyCode, which: keyCode, bubbles: true, cancelable: true };
    el.dispatchEvent(new KeyboardEvent("keydown", init));
    el.dispatchEvent(new KeyboardEvent("keypress", init));
    el.dispatchEvent(new KeyboardEvent("keyup", init));
  }

  async function fillTags(tags, tagMax = 25) {
    const el = findField(["tag"], ["tool", "field", "image"]);
    if (!el) return false;
    // Behance rejects tags > 25 chars or containing < > (and commas split tags), so never type those
    const clean = tags
      .map((t) => String(t).replace(/[<>,]/g, " ").replace(/\s+/g, " ").trim())
      .filter((t) => t && t.length <= tagMax);
    for (const tag of clean) {
      setText(el, tag);
      await sleep(180);
      pressKey(el, "Enter", "Enter", 13);
      await sleep(260);
    }
    return true;
  }

  // Real field limits from maxlength attributes, when those fields are visible.
  function getLimits() {
    const lim = (el) => (el && el.maxLength > 0 && el.maxLength < 100000 ? el.maxLength : 0);
    return {
      titleMax: lim(findField(["title", "project name", "name"], ["tag", "description"])),
      descMax: lim(findField(["description", "about", "summary"], ["tag"])),
      tagMax: lim(findField(["tag"], ["tool", "field", "image"])),
    };
  }

  // Error banners Behance shows (e.g. "Project Tags are limited to 25 characters ...").
  function readPageErrors() {
    const sel = '[role="alert"], [class*="error" i], [class*="alert" i], [class*="notification" i], [class*="banner" i], [class*="toast" i]';
    const texts = new Set();
    document.querySelectorAll(sel).forEach((el) => {
      if (!visible(el)) return;
      const t = (el.innerText || "").replace(/\s+/g, " ").trim();
      if (t && t.length < 300 && /limited to|cannot contain|too long|too short|required|must be|invalid|not allowed/i.test(t)) texts.add(t);
    });
    return [...texts];
  }

  // Removes old chips by pressing Backspace in an EMPTY tag-style input (safe: only keystrokes inside that input).
  async function clearViaBackspace(el, times) {
    el.focus();
    setText(el, "");
    for (let i = 0; i < times; i++) {
      pressKey(el, "Backspace", "Backspace", 8);
      await sleep(70);
    }
  }

  // Creative fields: type the name, then click the matching dropdown option from the editor's own list.
  async function fillFields(fields, max, replaceOld) {
    const el = findField(["creative field", "creative", "field"], ["tag", "tool", "image"]);
    if (!el) return 0;
    if (replaceOld) await clearViaBackspace(el, 6);
    const norm = (o) => (o.innerText || "").replace(/\s+/g, " ").trim().toLowerCase();
    let n = 0;
    for (const name of fields.slice(0, max)) {
      setText(el, name);
      await sleep(600);
      const want = name.toLowerCase();
      const opts = [...document.querySelectorAll('[role="option"], li, [class*="option" i], [class*="suggestion" i], [class*="result" i]')].filter(
        (o) => visible(o) && o !== el && !o.contains(el) && norm(o) && norm(o).length < 60
      );
      const pick = opts.find((o) => norm(o) === want) || opts.find((o) => norm(o).startsWith(want)) || opts.find((o) => norm(o).includes(want));
      if (pick) {
        pick.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
        pick.click();
        n++;
      } else {
        pressKey(el, "Enter", "Enter", 13);
      }
      await sleep(400);
      setText(el, "");
    }
    return n;
  }

  async function fill({ title, tags, description, tagMax, fields, fieldCount, replaceOld }) {
    const out = { title: false, tags: false, description: false, errors: [] };
    const clean = (s) => String(s || "").replace(/[<>]/g, " ").replace(/\s+/g, " ").trim();
    const tEl = findField(["title", "project name", "name"], ["tag", "description"]);
    if (tEl && title) {
      setText(tEl, clean(title));
      out.title = true;
    }
    const dEl = findField(["description", "about", "summary"], ["tag"]);
    if (dEl && description) {
      setText(dEl, clean(description));
      out.description = true;
    }
    if (fields && fields.length) out.fieldsCount = await fillFields(fields, fieldCount || 3, replaceOld);
    if (tags && tags.length) {
      if (replaceOld) {
        const tagEl = findField(["tag"], ["tool", "field", "image"]);
        if (tagEl) await clearViaBackspace(tagEl, 12);
      }
      out.tags = await fillTags(tags, tagMax || 20);
    }
    await sleep(700);
    out.errors = readPageErrors();
    return out;
  }

  /* ---------- collect all project images ---------- */
  function findScroller() {
    const root = document.scrollingElement || document.documentElement;
    let best = root;
    let bestH = root.scrollHeight;
    for (const el of document.querySelectorAll("div, main, section")) {
      if (el.scrollHeight > el.clientHeight + 300 && /(auto|scroll)/.test(getComputedStyle(el).overflowY) && el.scrollHeight > bestH) {
        best = el;
        bestH = el.scrollHeight;
      }
    }
    return best;
  }

  // Scroll through the whole page so lazy-loaded images actually load.
  async function autoScroll() {
    const sc = findScroller();
    const isRoot = sc === document.scrollingElement || sc === document.documentElement;
    const step = Math.max(500, Math.floor((isRoot ? window.innerHeight : sc.clientHeight) * 0.8));
    let y = 0;
    let guard = 0;
    while (y < sc.scrollHeight && guard++ < 400) {
      if (isRoot) window.scrollTo(0, y);
      else sc.scrollTop = y;
      await sleep(140);
      y += step;
    }
    await sleep(400);
    if (isRoot) window.scrollTo(0, 0);
    else sc.scrollTop = 0;
  }

  function isProjectImage(img) {
    if (!img.complete || img.naturalWidth < 300 || img.naturalHeight < 120) return false;
    const r = img.getBoundingClientRect();
    if (r.width < 150) return false;
    if (img.closest("header, nav, footer, aside, [role='navigation'], [class*='avatar' i], [class*='Avatar']")) return false;
    return true;
  }

  async function collectImages(maxImages, edge) {
    await autoScroll();
    const seen = new Set();
    const items = [];
    const imgs = [...document.querySelectorAll("img")].filter(isProjectImage);
    for (const img of imgs) {
      if (items.length >= maxImages) break;
      const src = img.currentSrc || img.src;
      if (!src || seen.has(src)) continue;
      seen.add(src);
      try {
        const scale = Math.min(1, edge / Math.max(img.naturalWidth, img.naturalHeight));
        const c = document.createElement("canvas");
        c.width = Math.max(1, Math.round(img.naturalWidth * scale));
        c.height = Math.max(1, Math.round(img.naturalHeight * scale));
        c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
        items.push({ dataUrl: c.toDataURL("image/jpeg", 0.65) });
      } catch (e) {
        // tainted canvas (cross-origin): let the side panel download it instead
        if (/^https?:/.test(src)) items.push({ url: src });
      }
    }
    return { items, totalFound: imgs.length };
  }

  /* ---------- per-image tags (editor side panel suggestions) ---------- */
  let imgJob = null;
  const notify = (m) => {
    try {
      const p = chrome.runtime.sendMessage(m);
      if (p && p.catch) p.catch(() => {});
    } catch (e) {}
  };
  async function waitFor(fn, ms = 2000, step = 150) {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) {
      const v = fn();
      if (v) return v;
      await sleep(step);
    }
    return null;
  }
  function editorImages() {
    const seen = new Set();
    return [...document.querySelectorAll("img")].filter((img) => {
      if (!isProjectImage(img)) return false;
      const src = img.currentSrc || img.src;
      if (!src || seen.has(src)) return false;
      seen.add(src);
      return true;
    });
  }
  async function clickImage(img) {
    img.scrollIntoView({ block: "center" });
    await sleep(150);
    for (const t of ["mousedown", "mouseup"]) img.dispatchEvent(new MouseEvent(t, { bubbles: true, cancelable: true, view: window }));
    img.click();
  }
  // The "Add tags" input that appears in the side panel when an image is selected.
  function imageTagInput() {
    const els = [...document.querySelectorAll('input[type="text"], input:not([type]), [contenteditable="true"], [role="textbox"], [role="combobox"]')];
    return els.find((el) => visible(el) && /tag/.test(attrText(el)) && !/search|project/.test(attrText(el))) || null;
  }
  // Short 1-2 word chips/buttons around the input = Behance's suggested tags.
  function readSuggestions(input) {
    let box = input;
    for (let i = 0; i < 5 && box.parentElement; i++) box = box.parentElement;
    const skip = /^(add|add tag|add tags|tags|save|done|cancel|delete|remove|apply|close|alt text|suggested|suggested tags|related|related tags|suggestions|image tags?|clear|edit)$/i;
    const seen = new Set();
    const out = [];
    for (const n of box.querySelectorAll("button, [role='button'], li, span, a, div")) {
      if (!visible(n) || n.children.length > 1 || n.contains(input) || input.contains(n)) continue;
      const t = (n.innerText || "").replace(/\s+/g, " ").trim();
      if (!t || t.length > 20 || t.split(" ").length > 2 || skip.test(t)) continue;
      const k = t.toLowerCase();
      if (seen.has(k)) continue;
      seen.add(k);
      out.push({ el: n, text: t });
    }
    return out;
  }
  // Prefer suggestions that match the project's vocabulary; top up to the minimum; never exceed the maximum.
  function chooseTags(sugs, vocab, min, max, tagMax) {
    const clean = (t) => t.replace(/[<>,]/g, " ").replace(/\s+/g, " ").trim();
    const score = (t) =>
      t
        .toLowerCase()
        .split(/[^\p{L}\p{N}]+/u)
        .filter(Boolean)
        .reduce((a, w) => {
          if (vocab.has(w)) return a + 2;
          if (w.length > 3 && [...vocab].some((v) => v.length > 3 && (v.includes(w) || w.includes(v)))) return a + 1;
          return a;
        }, 0);
    const items = sugs
      .map((s, idx) => ({ ...s, text: clean(s.text), idx }))
      .filter((s) => s.text && s.text.length <= tagMax)
      .map((s) => ({ ...s, sc: score(s.text) }))
      .sort((a, b) => b.sc - a.sc || a.idx - b.idx);
    const picked = items.filter((s) => s.sc > 0).slice(0, max);
    for (const s of items) {
      if (picked.length >= Math.min(min, items.length)) break;
      if (!picked.includes(s)) picked.push(s);
    }
    return picked.slice(0, max);
  }
  async function applyImageTags(input, chosen) {
    let added = 0;
    for (const s of chosen) {
      const inp = imageTagInput() || input;
      const cur = readSuggestions(inp).find((x) => x.text.toLowerCase() === s.text.toLowerCase());
      if (!cur) continue; // already consumed or gone
      cur.el.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
      cur.el.click();
      await sleep(300);
      const still = readSuggestions(imageTagInput() || inp).some((x) => x.text.toLowerCase() === s.text.toLowerCase());
      if (still) {
        // click did not consume it: add by typing instead
        const inp2 = imageTagInput() || inp;
        setText(inp2, s.text);
        await sleep(120);
        pressKey(inp2, "Enter", "Enter", 13);
        await sleep(300);
        setText(inp2, "");
      }
      added++;
    }
    return added;
  }
  async function runImageTags({ vocab, min, max, tagMax }) {
    const job = { cancel: false };
    imgJob = job;
    const set = new Set((vocab || []).map((w) => String(w).toLowerCase()));
    await autoScroll();
    const imgs = editorImages();
    let tagged = 0;
    let skipped = 0;
    let fails = 0;
    let error = "";
    for (let i = 0; i < imgs.length; i++) {
      if (job.cancel) break;
      await clickImage(imgs[i]);
      await sleep(700);
      const input = await waitFor(imageTagInput, 2500);
      if (!input) {
        fails++;
        skipped++;
        notify({ type: "IMG_TAG_PROGRESS", i: i + 1, n: imgs.length, tags: [], note: "tag panel not found" });
        if (fails >= 3 && tagged === 0) {
          error = "Image tag panel not found. Use the debug button below and send the copied HTML to Claude.";
          break;
        }
        continue;
      }
      fails = 0;
      const chosen = chooseTags(readSuggestions(input), set, min || 3, Math.min(7, max || 7), tagMax || 20);
      if (!chosen.length) {
        skipped++;
        notify({ type: "IMG_TAG_PROGRESS", i: i + 1, n: imgs.length, tags: [], note: "no suggestions" });
        continue;
      }
      await applyImageTags(input, chosen);
      tagged++;
      notify({ type: "IMG_TAG_PROGRESS", i: i + 1, n: imgs.length, tags: chosen.map((c) => c.text) });
      await sleep(250);
    }
    notify({ type: "IMG_TAG_PROGRESS", done: true, tagged, skipped, n: imgs.length, cancelled: job.cancel, error });
    imgJob = null;
  }
  // For debugging: click the first image and return the HTML around the image tag input.
  async function debugImagePanel() {
    const imgs = editorImages();
    if (!imgs.length) return { error: "no project images found on this page" };
    await clickImage(imgs[0]);
    await sleep(900);
    const input = imageTagInput();
    if (!input) {
      const inputs = [...document.querySelectorAll("input, textarea, [contenteditable='true'], [role='textbox'], [role='combobox']")]
        .filter(visible)
        .slice(0, 25)
        .map((el) => el.tagName + " | " + attrText(el).slice(0, 160));
      return { error: "tag input not found after clicking the first image", visibleInputs: inputs };
    }
    let box = input;
    for (let i = 0; i < 6 && box.parentElement; i++) box = box.parentElement;
    const html = box.outerHTML
      .replace(/<svg[\s\S]*?<\/svg>/g, "<svg/>")
      .replace(/\s(style|d|viewBox|srcset|src)="[^"]*"/g, "")
      .slice(0, 20000);
    return { html };
  }

  function clickPublish() {
    const btns = [...document.querySelectorAll("button, [role='button'], a")].filter((b) => visible(b) && /^\s*publish\s*$/i.test(b.textContent || ""));
    if (!btns.length) return false;
    btns[btns.length - 1].click();
    return true;
  }

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg.type === "FILL") {
      fill(msg.payload).then(sendResponse);
      return true;
    }
    if (msg.type === "GRAB_IMAGES") {
      collectImages(msg.maxImages || 300, msg.edge || 448)
        .then(sendResponse)
        .catch((e) => sendResponse({ items: [], totalFound: 0, error: String(e) }));
      return true;
    }
    if (msg.type === "START_IMAGE_TAGS") {
      if (imgJob) {
        sendResponse({ started: false, error: "Image tagging is already running." });
        return false;
      }
      runImageTags(msg.payload || {}).catch((e) => {
        notify({ type: "IMG_TAG_PROGRESS", done: true, tagged: 0, skipped: 0, n: 0, error: String(e) });
        imgJob = null;
      });
      sendResponse({ started: true });
      return false;
    }
    if (msg.type === "STOP_IMAGE_TAGS") {
      if (imgJob) imgJob.cancel = true;
      sendResponse({ ok: true });
      return false;
    }
    if (msg.type === "DEBUG_IMAGE_PANEL") {
      debugImagePanel().then(sendResponse).catch((e) => sendResponse({ error: String(e) }));
      return true;
    }
    if (msg.type === "GET_LIMITS") {
      sendResponse(getLimits());
      return false;
    }
    if (msg.type === "PUBLISH") {
      sendResponse({ clicked: clickPublish() });
      return false;
    }
  });
})();
