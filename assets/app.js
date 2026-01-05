/* =========================================================
   Instagram Follow Analyzer — static / vanilla / offline
   - Supports:
     1) followers JSON: root ARRAY of objects
        username:
          - priority: item["string_list_data"][0]["value"]
          - fallback: item["title"] if non-empty
     2) following JSON: root OBJECT with "relationships_following" ARRAY
        username:
          - priority: item["title"]
          - fallback: item["string_list_data"][0]["value"] if present
   - Normalization:
     trim, lowercase, remove leading '@', ignore empty, dedupe with Set
========================================================= */

(() => {
  "use strict";

  // ====== Required by spec (placeholder you will replace) ======
  const DATA_DOWNLOAD_URL = "https://accountscenter.instagram.com/info_and_permissions/dyi/";

  // ====== DOM refs ======
  const $ = (sel, root = document) => root.querySelector(sel);

  const igDownloadBtn = $("#igDownloadBtn");

  const projectNameEl = $("#projectName");
  const followersFileEl = $("#followersFile");
  const followingFileEl = $("#followingFile");
  const followersDrop = $("#followersDrop");
  const followingDrop = $("#followingDrop");
  const followersMeta = $("#followersMeta");
  const followingMeta = $("#followingMeta");

  const analyzeBtn = $("#analyzeBtn");
  const resetBtn = $("#resetBtn");

  const statusBanner = $("#statusBanner");

  const followersCountEl = $("#followersCount");
  const followingCountEl = $("#followingCount");
  const notFollowingBackCountEl = $("#notFollowingBackCount");
  const iDontFollowBackCountEl = $("#iDontFollowBackCount");
  const notFollowingBackPctEl = $("#notFollowingBackPct");
  const iDontFollowBackPctEl = $("#iDontFollowBackPct");

  const downloadBtn = $("#downloadBtn");
  const downloadJsonBtn = $("#downloadJsonBtn");
  const downloadMdBtn = $("#downloadMdBtn");
  const generatedMetaEl = $("#generatedMeta");

  const nfSearchEl = $("#nfSearch");
  const idfbSearchEl = $("#idfbSearch");
  const nfSortBtn = $("#nfSortBtn");
  const idfbSortBtn = $("#idfbSortBtn");
  const nfCopyBtn = $("#nfCopyBtn");
  const idfbCopyBtn = $("#idfbCopyBtn");
  const nfCountPill = $("#nfCountPill");
  const idfbCountPill = $("#idfbCountPill");

  const debugBox = $("#debugBox");
  const toastEl = $("#toast");

  // Virtual list containers
  const nfListEl = $("#nfList");
  const idfbListEl = $("#idfbList");

  // ====== State ======
  const state = {
    files: {
      followers: null, // { name, text }
      following: null, // { name, text }
    },
    computed: null, // populated after analyze
    ui: {
      nfSortAsc: true,
      idfbSortAsc: true,
      nfQuery: "",
      idfbQuery: "",
    }
  };

  // ====== Pure utilities ======
  function normalizeUsername(raw) {
    if (raw == null) return null;
    let s = String(raw).trim().toLowerCase();
    if (!s) return null;
    if (s.startsWith("@")) s = s.slice(1);
    s = s.trim();
    if (!s) return null;
    return s;
  }

  function safeGet(obj, pathArr) {
    // pathArr example: ["string_list_data", 0, "value"]
    let cur = obj;
    for (const key of pathArr) {
      if (cur == null) return undefined;
      cur = cur[key];
    }
    return cur;
  }

  function parseJson(text, labelForError) {
    try {
      return JSON.parse(text);
    } catch (err) {
      const msg = `JSON invalido (${labelForError}). Verifica che il file sia un JSON valido. Dettaglio: ${err && err.message ? err.message : String(err)}`;
      throw new Error(msg);
    }
  }

  function extractFollowersUsernames(json) {
    if (!Array.isArray(json)) {
      throw new Error(
        "Formato followers inatteso. Mi aspettavo root = ARRAY (lista di oggetti)."
      );
    }

    const out = [];
    for (const item of json) {
      // priority: string_list_data[0].value
      const v = safeGet(item, ["string_list_data", 0, "value"]);
      const t = item && typeof item.title === "string" ? item.title : "";
      const raw = (v != null && String(v).trim() !== "") ? v : t;
      const norm = normalizeUsername(raw);
      if (norm) out.push(norm);
    }
    return out;
  }

  function extractFollowingUsernames(json) {
    const arr = json && typeof json === "object" ? json.relationships_following : null;
    if (!Array.isArray(arr)) {
      throw new Error(
        "Formato following inatteso. Mi aspettavo root = OBJECT con chiave 'relationships_following' (ARRAY)."
      );
    }

    const out = [];
    for (const item of arr) {
      // priority: title
      const t = item && typeof item.title === "string" ? item.title : "";
      // fallback: string_list_data[0].value
      const v = safeGet(item, ["string_list_data", 0, "value"]);
      const raw = (t && t.trim() !== "") ? t : v;
      const norm = normalizeUsername(raw);
      if (norm) out.push(norm);
    }
    return out;
  }

  function toSet(list) {
    const s = new Set();
    for (const x of list) s.add(x);
    return s;
  }

  function setDiff(aSet, bSet) {
    const out = [];
    for (const x of aSet) {
      if (!bSet.has(x)) out.push(x);
    }
    out.sort((a, b) => a.localeCompare(b));
    return out;
  }

  function pct(part, total) {
    if (!total || total <= 0) return "0%";
    const v = (part / total) * 100;
    // 1 decimal if < 10%, else 0 decimals — feels nicer on dashboard
    const digits = v < 10 ? 1 : 0;
    return `${v.toFixed(digits)}%`;
  }

  function isoNow() {
    return new Date().toISOString();
  }

  function sanitizeProjectName(name) {
    const base = (name || "").trim();
    if (!base) return "instagram-follow-report";
    // safe-ish filename: keep [a-z0-9-_]
    const s = base.toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9\-_]/g, "");
    return s || "instagram-follow-report";
  }

  // ====== Virtual list component ======
  class VirtualList {
    constructor(rootEl, { itemHeight = 36, overscan = 8 } = {}) {
      this.rootEl = rootEl;
      this.itemHeight = itemHeight;
      this.overscan = overscan;

      this.spacerEl = rootEl.querySelector(".vlist-spacer");
      this.itemsEl = rootEl.querySelector(".vlist-items");

      this.data = [];
      this._ticking = false;

      this.onScroll = this.onScroll.bind(this);
      rootEl.addEventListener("scroll", this.onScroll, { passive: true });

      // keyboard: allow enter to copy on focused row
      rootEl.addEventListener("keydown", (e) => {
        if (e.key !== "Enter") return;
        const active = document.activeElement;
        if (active && active.classList && active.classList.contains("vrow")) {
          const user = active.getAttribute("data-user");
          if (user) copyToClipboard(user).then(() => showToast(`Copiato: ${user}`));
        }
      });
    }

    setData(data) {
      this.data = Array.isArray(data) ? data : [];
      this.spacerEl.style.height = `${this.data.length * this.itemHeight}px`;
      this.rootEl.scrollTop = 0;
      this.render();
    }

    onScroll() {
      if (this._ticking) return;
      this._ticking = true;
      requestAnimationFrame(() => {
        this._ticking = false;
        this.render();
      });
    }

    render() {
      const total = this.data.length;
      const viewportH = this.rootEl.clientHeight;
      const scrollTop = this.rootEl.scrollTop;

      const start = Math.max(0, Math.floor(scrollTop / this.itemHeight) - this.overscan);
      const visibleCount = Math.ceil(viewportH / this.itemHeight) + (this.overscan * 2);
      const end = Math.min(total, start + visibleCount);

      const slice = this.data.slice(start, end);

      // Rebuild minimal DOM (fragment) — cheap because slice is small
      const frag = document.createDocumentFragment();
      for (let i = 0; i < slice.length; i++) {
        const user = slice[i];
        const row = document.createElement("div");
        row.className = "vrow";
        row.setAttribute("role", "listitem");
        row.setAttribute("tabindex", "0");
        row.setAttribute("data-user", user);

        const idx = document.createElement("div");
        idx.className = "handle";
        idx.textContent = String(start + i + 1);

        const u = document.createElement("div");
        u.className = "user";
        u.textContent = user;

        const chip = document.createElement("div");
        chip.className = "chip";
        chip.textContent = "@";

        row.appendChild(idx);
        row.appendChild(u);
        row.appendChild(chip);

        row.addEventListener("click", () => {
          copyToClipboard(user).then(() => showToast(`Copiato: ${user}`));
        });

        frag.appendChild(row);
      }

      this.itemsEl.innerHTML = "";
      this.itemsEl.appendChild(frag);
      this.itemsEl.style.transform = `translateY(${start * this.itemHeight}px)`;
    }
  }

  const nfVList = new VirtualList(nfListEl, { itemHeight: parseInt(getCssVar("--row-h"), 10) || 36 });
  const idfbVList = new VirtualList(idfbListEl, { itemHeight: parseInt(getCssVar("--row-h"), 10) || 36 });

  function getCssVar(name) {
    return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  }

  // ====== UI helpers ======
  function setStatus(type, text) {
    statusBanner.className = `status-banner status-${type}`;
    statusBanner.querySelector(".status-text").innerHTML = text;
  }

  function setLoading(isLoading) {
    if (isLoading) {
      setStatus("loading", "Parsing JSON e calcolo set…");
    }
  }

  function showToast(msg) {
    toastEl.textContent = msg;
    toastEl.classList.add("show");
    window.clearTimeout(showToast._t);
    showToast._t = window.setTimeout(() => toastEl.classList.remove("show"), 1800);
  }

  async function copyToClipboard(text) {
    const s = String(text ?? "");
    if (!s) return;

    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(s);
    }

    // Fallback: textarea + execCommand (legacy)
    const ta = document.createElement("textarea");
    ta.value = s;
    ta.setAttribute("readonly", "");
    ta.style.position = "fixed";
    ta.style.left = "-9999px";
    ta.style.top = "0";
    document.body.appendChild(ta);
    ta.select();
    try {
      document.execCommand("copy");
    } finally {
      document.body.removeChild(ta);
    }
  }

  function enablePostAnalyzeUI(enabled) {
    nfSearchEl.disabled = !enabled;
    idfbSearchEl.disabled = !enabled;
    nfSortBtn.disabled = !enabled;
    idfbSortBtn.disabled = !enabled;
    nfCopyBtn.disabled = !enabled;
    idfbCopyBtn.disabled = !enabled;

    downloadBtn.disabled = !enabled;
    downloadJsonBtn.disabled = !enabled;
    downloadMdBtn.disabled = !enabled;
  }

  function updateAnalyzeEnabled() {
    const ok = Boolean(state.files.followers && state.files.following);
    analyzeBtn.disabled = !ok;
    if (!ok) {
      setStatus("empty", "Carica entrambi i file per abilitare <strong>Analyze</strong>.");
    } else {
      setStatus("ok", "File caricati. Premi <strong>Analyze</strong>.");
    }
  }

  function formatBytes(bytes) {
    const b = Number(bytes || 0);
    if (b < 1024) return `${b} B`;
    const kb = b / 1024;
    if (kb < 1024) return `${kb.toFixed(1)} KB`;
    const mb = kb / 1024;
    return `${mb.toFixed(1)} MB`;
  }

  // ====== File reading ======
  function readFileAsText(file) {
    return new Promise((resolve, reject) => {
      const fr = new FileReader();
      fr.onerror = () => reject(new Error("Impossibile leggere il file (FileReader error)."));
      fr.onload = () => resolve(String(fr.result || ""));
      fr.readAsText(file);
    });
  }

  async function handleFileInput(which, file) {
    if (!file) return;
    setStatus("loading", `Caricamento ${which}…`);
    try {
      const text = await readFileAsText(file);
      state.files[which] = { name: file.name, size: file.size, text };

      if (which === "followers") {
        followersMeta.textContent = `${file.name} • ${formatBytes(file.size)}`;
      } else {
        followingMeta.textContent = `${file.name} • ${formatBytes(file.size)}`;
      }

      showToast(`${which} caricato`);
      updateAnalyzeEnabled();
    } catch (err) {
      state.files[which] = null;
      updateAnalyzeEnabled();
      setStatus("error", escapeHtml(err.message || String(err)));
    }
  }

  function wireDropzone(dropEl, inputEl, which) {
    // click anywhere -> open file picker
    dropEl.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        // showPicker (Chrome) fallback click (others)
        if (typeof inputEl.showPicker === "function") inputEl.showPicker();
        else inputEl.click();
    }
    });

    // drag & drop
    dropEl.addEventListener("dragover", (e) => {
      e.preventDefault();
      dropEl.classList.add("is-dragover");
    });
    dropEl.addEventListener("dragleave", () => dropEl.classList.remove("is-dragover"));
    dropEl.addEventListener("drop", (e) => {
      e.preventDefault();
      dropEl.classList.remove("is-dragover");
      const file = e.dataTransfer && e.dataTransfer.files ? e.dataTransfer.files[0] : null;
      if (file) handleFileInput(which, file);
    });

    // input change
    inputEl.addEventListener("change", () => {
      const file = inputEl.files && inputEl.files[0] ? inputEl.files[0] : null;
      if (file) handleFileInput(which, file);
    });
  }

  // ====== Analyze pipeline ======
  function compute() {
    const followersRaw = parseJson(state.files.followers.text, "followers");
    const followingRaw = parseJson(state.files.following.text, "following");

    const followersList = extractFollowersUsernames(followersRaw);
    const followingList = extractFollowingUsernames(followingRaw);

    const followersSet = toSet(followersList);
    const followingSet = toSet(followingList);

    const followers_count = followersSet.size;
    const following_count = followingSet.size;

    const not_following_back = setDiff(followingSet, followersSet); // following \ followers
    const i_dont_follow_back = setDiff(followersSet, followingSet); // followers \ following

    return {
      project: (projectNameEl.value || "").trim() || "Untitled",
      generated: isoNow(),
      followers_count,
      following_count,
      not_following_back,
      i_dont_follow_back,
      debug: {
        followers_input_count: followersList.length,
        following_input_count: followingList.length,
        followers_deduped: followers_count,
        following_deduped: following_count,
        notes: [
          "Normalizzazione: trim + lowercase + remove leading '@' + ignore empty + Set dedupe",
          "Sorting: localeCompare su lowercase => stable A→Z / Z→A"
        ]
      }
    };
  }

  function updateDashboard(result) {
    followersCountEl.textContent = String(result.followers_count);
    followingCountEl.textContent = String(result.following_count);
    notFollowingBackCountEl.textContent = String(result.not_following_back.length);
    iDontFollowBackCountEl.textContent = String(result.i_dont_follow_back.length);

    notFollowingBackPctEl.textContent = pct(result.not_following_back.length, result.following_count);
    iDontFollowBackPctEl.textContent = pct(result.i_dont_follow_back.length, result.followers_count);

    generatedMetaEl.textContent = `Generated: ${result.generated}`;

    debugBox.textContent = JSON.stringify({
      project: result.project,
      generated: result.generated,
      followers_count: result.followers_count,
      following_count: result.following_count,
      not_following_back_sample: result.not_following_back.slice(0, 10),
      i_dont_follow_back_sample: result.i_dont_follow_back.slice(0, 10),
      debug: result.debug
    }, null, 2);
  }

  function sortList(arr, asc) {
    const copy = arr.slice();
    copy.sort((a, b) => asc ? a.localeCompare(b) : b.localeCompare(a));
    return copy;
  }

  function applyFiltersAndRender() {
    if (!state.computed) return;

    const nfBase = sortList(state.computed.not_following_back, state.ui.nfSortAsc);
    const idfbBase = sortList(state.computed.i_dont_follow_back, state.ui.idfbSortAsc);

    const nfQ = (state.ui.nfQuery || "").trim().toLowerCase();
    const idfbQ = (state.ui.idfbQuery || "").trim().toLowerCase();

    const nfFiltered = nfQ ? nfBase.filter(u => u.includes(nfQ)) : nfBase;
    const idfbFiltered = idfbQ ? idfbBase.filter(u => u.includes(idfbQ)) : idfbBase;

    nfCountPill.textContent = String(nfFiltered.length);
    idfbCountPill.textContent = String(idfbFiltered.length);

    nfVList.setData(nfFiltered);
    idfbVList.setData(idfbFiltered);
  }

  // ====== Export generation ======
  function buildExportJson() {
    const res = state.computed;
    return {
      project: res.project,
      generated: res.generated,
      followers_count: res.followers_count,
      following_count: res.following_count,
      not_following_back: res.not_following_back,
      i_dont_follow_back: res.i_dont_follow_back
    };
  }

  function buildReportMd() {
    const res = state.computed;

    const lines = [];
    lines.push(`Project: ${res.project}`);
    lines.push(`Generated: ${res.generated}`);
    lines.push("");
    lines.push("SUMMARY");
    lines.push(`- Followers: ${res.followers_count}`);
    lines.push(`- Following: ${res.following_count}`);
    lines.push(`- Not following back: ${res.not_following_back.length}`);
    lines.push(`- I don't follow back: ${res.i_dont_follow_back.length}`);
    lines.push("");

    lines.push("NOT FOLLOWING BACK (following - followers)");
    if (res.not_following_back.length === 0) {
      lines.push("—");
    } else {
      res.not_following_back.forEach((u, i) => lines.push(`${i + 1}. ${u}`));
    }
    lines.push("");

    lines.push("I DON'T FOLLOW BACK (followers - following)");
    if (res.i_dont_follow_back.length === 0) {
      lines.push("—");
    } else {
      res.i_dont_follow_back.forEach((u, i) => lines.push(`${i + 1}. ${u}`));
    }
    lines.push("");

    return lines.join("\n");
  }

  function downloadBlob(filename, content, mime) {
    const blob = new Blob([content], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  function doDownloadJson() {
    const safeName = sanitizeProjectName(state.computed.project);
    const filename = `${safeName}-export.json`;
    const payload = JSON.stringify(buildExportJson(), null, 2);
    downloadBlob(filename, payload, "application/json;charset=utf-8");
  }

  function doDownloadMd() {
    const safeName = sanitizeProjectName(state.computed.project);
    const filename = `${safeName}-report.md`;
    const payload = buildReportMd();
    downloadBlob(filename, payload, "text/markdown;charset=utf-8");
  }

  // ====== Reset ======
  function resetAll() {
    state.files.followers = null;
    state.files.following = null;
    state.computed = null;
    state.ui.nfSortAsc = true;
    state.ui.idfbSortAsc = true;
    state.ui.nfQuery = "";
    state.ui.idfbQuery = "";

    followersFileEl.value = "";
    followingFileEl.value = "";

    followersMeta.textContent = "Nessun file selezionato";
    followingMeta.textContent = "Nessun file selezionato";

    projectNameEl.value = "";

    followersCountEl.textContent = "—";
    followingCountEl.textContent = "—";
    notFollowingBackCountEl.textContent = "—";
    iDontFollowBackCountEl.textContent = "—";
    notFollowingBackPctEl.textContent = "—";
    iDontFollowBackPctEl.textContent = "—";

    nfSearchEl.value = "";
    idfbSearchEl.value = "";

    nfCountPill.textContent = "0";
    idfbCountPill.textContent = "0";

    generatedMetaEl.textContent = "—";
    debugBox.textContent = "—";

    nfVList.setData([]);
    idfbVList.setData([]);

    enablePostAnalyzeUI(false);
    updateAnalyzeEnabled();
  }

  // ====== Misc ======
  function escapeHtml(s) {
    return String(s)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  // ====== Wire events ======
  function init() {
    igDownloadBtn.href = DATA_DOWNLOAD_URL;

    wireDropzone(followersDrop, followersFileEl, "followers");
    wireDropzone(followingDrop, followingFileEl, "following");

    analyzeBtn.addEventListener("click", () => {
      if (!state.files.followers || !state.files.following) return;

      setLoading(true);
      enablePostAnalyzeUI(false);

      try {
        const res = compute();
        state.computed = res;

        // init UI defaults
        nfSortBtn.textContent = "Sort: A→Z";
        idfbSortBtn.textContent = "Sort: A→Z";
        nfSearchEl.value = "";
        idfbSearchEl.value = "";
        state.ui.nfQuery = "";
        state.ui.idfbQuery = "";

        updateDashboard(res);
        applyFiltersAndRender();
        enablePostAnalyzeUI(true);

        setStatus("ok", "Done. Usa search/sort/copy oppure scarica il report.");
        showToast("Analisi completata");
      } catch (err) {
        console.error(err);
        setStatus(
          "error",
          `${escapeHtml(err.message || String(err))}<br><span class="muted">Hint: apri “Debug / parsing hints” per vedere contesto.</span>`
        );
        enablePostAnalyzeUI(false);
      }
    });

    resetBtn.addEventListener("click", () => {
      resetAll();
      showToast("Reset");
    });

    // Search
    nfSearchEl.addEventListener("input", () => {
      state.ui.nfQuery = nfSearchEl.value;
      applyFiltersAndRender();
    });
    idfbSearchEl.addEventListener("input", () => {
      state.ui.idfbQuery = idfbSearchEl.value;
      applyFiltersAndRender();
    });

    // Sort toggles
    nfSortBtn.addEventListener("click", () => {
      state.ui.nfSortAsc = !state.ui.nfSortAsc;
      nfSortBtn.textContent = state.ui.nfSortAsc ? "Sort: A→Z" : "Sort: Z→A";
      applyFiltersAndRender();
    });
    idfbSortBtn.addEventListener("click", () => {
      state.ui.idfbSortAsc = !state.ui.idfbSortAsc;
      idfbSortBtn.textContent = state.ui.idfbSortAsc ? "Sort: A→Z" : "Sort: Z→A";
      applyFiltersAndRender();
    });

    // Copy buttons
    nfCopyBtn.addEventListener("click", async () => {
      const res = state.computed;
      if (!res) return;
      const list = sortList(res.not_following_back, state.ui.nfSortAsc);
      const q = (state.ui.nfQuery || "").trim().toLowerCase();
      const filtered = q ? list.filter(u => u.includes(q)) : list;
      await copyToClipboard(filtered.join("\n"));
      showToast(`Copiati ${filtered.length} username`);
    });

    idfbCopyBtn.addEventListener("click", async () => {
      const res = state.computed;
      if (!res) return;
      const list = sortList(res.i_dont_follow_back, state.ui.idfbSortAsc);
      const q = (state.ui.idfbQuery || "").trim().toLowerCase();
      const filtered = q ? list.filter(u => u.includes(q)) : list;
      await copyToClipboard(filtered.join("\n"));
      showToast(`Copiati ${filtered.length} username`);
    });

    // Downloads
    downloadBtn.addEventListener("click", () => {
      if (!state.computed) return;
      doDownloadJson();
      // Small delay reduces the chance of browsers treating as "multiple automatic downloads"
      setTimeout(() => doDownloadMd(), 80);
      showToast("Download avviato (JSON + MD)");
    });

    downloadJsonBtn.addEventListener("click", () => {
      if (!state.computed) return;
      doDownloadJson();
      showToast("Download JSON");
    });

    downloadMdBtn.addEventListener("click", () => {
      if (!state.computed) return;
      doDownloadMd();
      showToast("Download MD");
    });

    // initial UI
    enablePostAnalyzeUI(false);
    updateAnalyzeEnabled();
  }

  document.addEventListener("DOMContentLoaded", init);
})();
