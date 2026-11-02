const DEFAULT_SETTINGS = {
  bgEnabled: true, bgType: "bambi", testTimeout: 1500, maxCandidates: 500,
  autoFind: false, autoApply: true, showSites: true, pingQuality: "medium",
  customPingMs: 800, manualProxy: "", protocolFilter: "all", siteMode: "whitelist",
  countryMode: "all", countryList: [], autoCheck: false, autoCheckInterval: 5, rotateInterval: 0,
  webrtcProtect: true, soundEnabled: true, dohEnabled: true, autoStart: false, ipSource: "ipify"
};

document.addEventListener("DOMContentLoaded", () => {
  const $ = (id) => document.getElementById(id);
  const bgEnabled = $("bgEnabled"), bgType = $("bgType"), showSites = $("showSites");
  const testTimeout = $("testTimeout"), maxCandidates = $("maxCandidates");
  const autoFind = $("autoFind"), autoApply = $("autoApply"), manualProxy = $("manualProxy");
  const protocolFilter = $("protocolFilter"), siteMode = $("siteMode"), countryMode = $("countryMode");
  const countryList = $("countryList"), autoCheck = $("autoCheck"), autoCheckInterval = $("autoCheckInterval");
  const autoRotate = $("autoRotate"), rotateInterval = $("rotateInterval");
  const webrtcProtect = $("webrtcProtect"), soundEnabled = $("soundEnabled"), dohEnabled = $("dohEnabled"), autoStart = $("autoStart"), ipSource = $("ipSource");
  const saveBtn = $("saveBtn"), applyManualBtn = $("applyManualBtn"), resetBtn = $("resetBtn"), eraseDataBtn = $("eraseDataBtn");
  const toast = $("toast"), preview = $("preview"), customPingRow = $("customPingRow"), customPingMs = $("customPingMs");
  const pingRadios = document.querySelectorAll('input[name="pingQuality"]');
  const exportBtn = $("exportBtn"), importFile = $("importFile");
  const eraseModal = $("eraseModal"), confirmErase = $("confirmErase"), cancelErase = $("cancelErase");
  const bulkSites = $("bulkSites"), saveBulkSites = $("saveBulkSites");

  load();

  [bgEnabled, bgType, showSites, testTimeout, maxCandidates, autoFind, autoApply, customPingMs, manualProxy, protocolFilter, siteMode, countryMode, countryList, autoCheck, autoCheckInterval, rotateInterval, autoRotate, webrtcProtect, soundEnabled, dohEnabled, autoStart, ipSource]
    .forEach(el => { if (!el) return; el.addEventListener("change", () => { updatePreview(); save(true); }); el.addEventListener("input", updatePreview); });

  pingRadios.forEach(r => r.addEventListener("change", () => { updateCustomPingVisibility(); save(true); }));

  saveBtn.addEventListener("click", () => save(false));
  resetBtn.addEventListener("click", reset);
  applyManualBtn.addEventListener("click", () => { save(false); chrome.runtime.sendMessage({ action: "applyManualProxy" }); showToast("Проверяю..."); });

  saveBulkSites.addEventListener("click", () => {
    const text = bulkSites.value.trim();
    if (!text) return;
    const newSites = text.split(/[\n,]+/).map(s => s.trim()).filter(Boolean);
    if (newSites.length === 0) return;
    chrome.storage.sync.get({ sites: [] }, (data) => {
      const current = Array.isArray(data.sites) ? data.sites : [];
      const combined = Array.from(new Set([...current, ...newSites]));
      chrome.storage.sync.set({ sites: combined }, () => { showToast("Загружено " + newSites.length + " сайтов"); bulkSites.value = ""; });
    });
  });

  exportBtn.addEventListener("click", () => {
    chrome.storage.local.get(null, (localData) => {
      chrome.storage.sync.get(null, (syncData) => {
        const data = { local: localData, sync: syncData };
        const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a"); a.href = url; a.download = "bambi-proxy-backup.json"; a.click(); URL.revokeObjectURL(url);
      });
    });
  });

  importFile.addEventListener("change", (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const data = JSON.parse(ev.target.result);
        if (data.local) chrome.storage.local.set(data.local);
        if (data.sync) chrome.storage.sync.set(data.sync);
        showToast("Импортировано!");
        setTimeout(load, 500);
      } catch (err) { showToast("Ошибка файла", true); }
    };
    reader.readAsText(file);
  });

  eraseDataBtn.addEventListener("click", () => eraseModal.classList.add("show"));
  cancelErase.addEventListener("click", () => eraseModal.classList.remove("show"));
  confirmErase.addEventListener("click", () => {
    chrome.runtime.sendMessage({ action: "clearAllData" });
    eraseModal.classList.remove("show");
    setTimeout(() => { showToast("Стерто"); load(); }, 300);
  });

  function load() {
    chrome.storage.local.get("settings", (data) => {
      const s = Object.assign({}, DEFAULT_SETTINGS, data.settings || {});
      bgEnabled.checked = s.bgEnabled; bgType.value = s.bgType; showSites.checked = s.showSites;
      testTimeout.value = s.testTimeout; maxCandidates.value = s.maxCandidates;
      autoFind.checked = s.autoFind; autoApply.checked = s.autoApply; customPingMs.value = s.customPingMs;
      manualProxy.value = s.manualProxy || ""; protocolFilter.value = s.protocolFilter || "all";
      siteMode.value = s.siteMode || "whitelist"; countryMode.value = s.countryMode || "all";
      countryList.value = (s.countryList || []).join(", "); autoCheck.checked = s.autoCheck; autoCheckInterval.value = s.autoCheckInterval;
      autoRotate.checked = (s.rotateInterval > 0); rotateInterval.value = s.rotateInterval;
      webrtcProtect.checked = s.webrtcProtect; soundEnabled.checked = s.soundEnabled;
      dohEnabled.checked = s.dohEnabled; autoStart.checked = s.autoStart; ipSource.value = s.ipSource;
      pingRadios.forEach(r => { r.checked = (r.value === (s.pingQuality || "medium")); });
      updateCustomPingVisibility(); updatePreview();
    });
  }

  function updateCustomPingVisibility() {
    let q = "medium"; pingRadios.forEach(r => { if (r.checked) q = r.value; });
    customPingRow.style.display = q === "custom" ? "" : "none";
  }

  function updatePreview() {
    preview.style.backgroundImage = ""; preview.style.background = ""; preview.classList.remove("show-overlay");
    if (!bgEnabled.checked) { preview.style.background = "#0d1117"; return; }
    if (bgType.value === "bambi") { preview.style.backgroundImage = "url('images/Bambi.png')"; preview.style.backgroundSize = "cover"; preview.style.backgroundPosition = "center"; preview.classList.add("show-overlay"); }
    else if (bgType.value === "dark") preview.style.background = "linear-gradient(135deg, #0d1117 0%, #1a1f2e 100%)";
    else if (bgType.value === "gradient") preview.style.background = "linear-gradient(135deg, #00ffff 0%, #ff64c8 100%)";
    else if (bgType.value === "matrix") preview.style.background = "#000000";
  }

  function save(silent) {
    let q = "medium"; pingRadios.forEach(r => { if (r.checked) q = r.value; });
    const list = (countryList.value || "").split(",").map(s => s.trim().toUpperCase()).filter(s => /^[A-Z]{2}$/.test(s));
    const s = {
      bgEnabled: bgEnabled.checked, bgType: bgType.value, showSites: showSites.checked,
      testTimeout: clamp(parseInt(testTimeout.value, 10) || 1500, 500, 15000),
      maxCandidates: clamp(parseInt(maxCandidates.value, 10) || 500, 5, 2000),
      autoFind: autoFind.checked, autoApply: autoApply.checked, pingQuality: q,
      customPingMs: clamp(parseInt(customPingMs.value, 10) || 800, 50, 15000),
      manualProxy: manualProxy.value.trim(), protocolFilter: protocolFilter.value,
      siteMode: siteMode.value, countryMode: countryMode.value, countryList: list,
      autoCheck: autoCheck.checked, autoCheckInterval: clamp(parseInt(autoCheckInterval.value, 10) || 5, 1, 120),
      rotateInterval: autoRotate.checked ? clamp(parseInt(rotateInterval.value, 10) || 5, 1, 1440) : 0,
      webrtcProtect: webrtcProtect.checked, soundEnabled: soundEnabled.checked,
      dohEnabled: dohEnabled.checked, autoStart: autoStart.checked, ipSource: ipSource.value
    };
    testTimeout.value = s.testTimeout; maxCandidates.value = s.maxCandidates;
    customPingMs.value = s.customPingMs; autoCheckInterval.value = s.autoCheckInterval; rotateInterval.value = s.rotateInterval;
    countryList.value = s.countryList.join(", ");
    chrome.storage.local.set({ settings: s }, () => { if (!silent) showToast("Сохранено"); });
  }

  function reset() {
    if (!confirm("Сбросить все настройки?")) return;
    chrome.storage.local.set({ settings: DEFAULT_SETTINGS }, () => { load(); showToast("Сброшено"); });
  }

  function clamp(v, min, max) { return Math.max(min, Math.min(max, v)); }
  let toastTimer = null;
  function showToast(text, isError) { toast.textContent = text; toast.style.background = isError ? "rgba(255, 80, 80, 0.95)" : "rgba(0, 200, 120, 0.95)"; toast.classList.add("show"); clearTimeout(toastTimer); toastTimer = setTimeout(() => toast.classList.remove("show"), 1500); }
});