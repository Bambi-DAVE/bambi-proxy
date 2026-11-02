document.addEventListener("DOMContentLoaded", () => {
  const toggleButton  = document.getElementById("toggleButton");
  const statusText    = document.getElementById("statusText");
  const siteSearch    = document.getElementById("siteSearch");
  const siteInput     = document.getElementById("siteInput");
  const addSiteButton = document.getElementById("addSiteButton");
  const siteList      = document.getElementById("siteList");
  const findButton    = document.getElementById("findButton");
  const proxyInfoText = document.getElementById("proxyInfoText");
  const pingButton    = document.getElementById("pingButton");
  const speedButton   = document.getElementById("speedButton");
  const rotateButton  = document.getElementById("rotateButton");
  const checkResult   = document.getElementById("checkResult");
  const speedResult   = document.getElementById("speedResult");
  const sourceSelect  = document.getElementById("sourceSelect");
  const protocolSelect = document.getElementById("protocolSelect");
  const settingsButton = document.getElementById("settingsButton");
  const sitesSection  = document.getElementById("sitesSection");
  const topSection    = document.getElementById("topSection");
  const topList       = document.getElementById("topList");
  const modeBadge     = document.getElementById("modeBadge");
  const devLink       = document.getElementById("devLink");
  
  const pacTestInput  = document.getElementById("pacTestInput");
  const pacTestBtn    = document.getElementById("pacTestBtn");
  const pacTestResult = document.getElementById("pacTestResult");
  const expandInfoBtn = document.getElementById("expandInfoBtn");
  const securityInfoContent = document.getElementById("securityInfoContent");
  const titleLogo     = document.getElementById("titleLogo");

  const statSearches = document.getElementById("statSearches");
  const statTested   = document.getElementById("statTested");
  const statLive     = document.getElementById("statLive");
  const statAvgPing  = document.getElementById("statAvgPing");

  let enabled = false;
  let searching = false;
  let currentProxyStr = "";
  let currentMode = "whitelist";
  let currentSites = [];

  // ПАСХАЛКА: ЛОМАЕМ 3D
  titleLogo.addEventListener("click", () => {
    document.body.style.transform = "rotate(180deg) scale(0.8)";
    document.body.style.transition = "transform 0.5s";
    console.log("БЭМБИ, ТЫ СЛОМАЛ 3D! ДЭЙВ БУДЕТ НЕДОВОЛЕН.");
    alert("ОЙ! ТЫ СЛОМАЛ 3D!\nПерезапусти попап, чтобы починить.");
    setTimeout(() => {
      document.body.style.transform = "rotate(0deg) scale(1)";
    }, 2000);
  });

  function getFlagEmoji(countryCode) {
    if (!countryCode || countryCode.length !== 2) return "🌐";
    return countryCode.toUpperCase().replace(/./g, char => String.fromCodePoint(127397 + char.charCodeAt()));
  }

  function playConnectSound() {
    chrome.storage.local.get("settings", (data) => {
      if (data.settings && data.settings.soundEnabled === false) return;
      try {
        const ctx = new (window.AudioContext || window.webkitAudioContext)();
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = "square";
        osc.frequency.setValueAtTime(600, ctx.currentTime);
        osc.frequency.exponentialRampToValueAtTime(300, ctx.currentTime + 0.1);
        gain.gain.setValueAtTime(0.2, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.1);
        osc.connect(gain); gain.connect(ctx.destination);
        osc.start(); osc.stop(ctx.currentTime + 0.1);
      } catch (e) {}
    });
  }

  chrome.storage.local.get("settings", (data) => applySettings(data.settings || {}));
  chrome.storage.sync.get({ sites: [], enabled: false, source: "all" }, (data) => {
    enabled = data.enabled;
    currentSites = data.sites || [];
    sourceSelect.value = data.source || "all";
    updateUI();
    currentSites.forEach(addSiteToList);
  });
  chrome.storage.local.get(["settings", "topProxies"], (data) => {
    protocolSelect.value = (data.settings && data.settings.protocolFilter) || "all";
    currentMode = (data.settings && data.settings.siteMode) || "whitelist";
    renderTop(data.topProxies || []);
  });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && changes.settings) applySettings(changes.settings.newValue || {});
    if (area === "local" && changes.stats) renderStats(changes.stats.newValue || {});
    if (area === "local" && changes.checkResult) renderCheckResult(changes.checkResult.newValue || {});
    if (area === "local" && changes.speedResult) renderSpeedResult(changes.speedResult.newValue || {});
    if (area === "local" && changes.topProxies) renderTop(changes.topProxies.newValue || {});
    if (area === "sync" && changes.enabled) { 
      const prev = enabled;
      enabled = changes.enabled.newValue; 
      updateUI(); 
      if (!prev && enabled) playConnectSound();
    }
    if (area === "sync" && changes.sites) {
      currentSites = changes.sites.newValue || [];
    }
  });

  refreshStatus();
  refreshStats();
  setInterval(refreshStatus, 700);

  expandInfoBtn.addEventListener("click", () => {
    const isCollapsed = securityInfoContent.classList.toggle("collapsed");
    expandInfoBtn.textContent = isCollapsed ? "РАЗВЕРНУТЬ ПОДРОБНЕЕ ⬇️" : "СВЕРНУТЬ ⬆️";
  });

  pacTestBtn.addEventListener("click", () => {
    const domain = pacTestInput.value.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "");
    if (!domain) return;
    if (currentSites.length === 0) {
      pacTestResult.style.display = "block";
      pacTestResult.className = "pac-test-result success";
      pacTestResult.textContent = "Список пуст. Весь трафик через прокси.";
      return;
    }
    let inList = false;
    currentSites.forEach(s => {
      const cleanS = s.toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "");
      if (cleanS.includes("*")) {
        const regexStr = cleanS.replace(/\./g, "\\.").replace(/\*/g, ".*");
        if (new RegExp("^" + regexStr + "$").test(domain)) inList = true;
      } else {
        if (domain === cleanS || domain.endsWith("." + cleanS) || domain.includes(cleanS)) inList = true;
      }
    });
    const useProxy = currentMode === "blacklist" ? !inList : inList;
    pacTestResult.style.display = "block";
    if (useProxy) {
      pacTestResult.className = "pac-test-result success";
      pacTestResult.textContent = "✅ Пойдёт через ПРОКСИ.";
    } else {
      pacTestResult.className = "pac-test-result error";
      pacTestResult.textContent = "⛔ Пойдёт НАПРЯМУЮ.";
    }
  });

  siteSearch.addEventListener("input", () => {
    const term = siteSearch.value.toLowerCase();
    const items = siteList.querySelectorAll(".site-item");
    items.forEach(el => {
      const text = el.textContent.toLowerCase();
      el.style.display = text.includes(term) ? "" : "none";
    });
  });

  proxyInfoText.addEventListener("click", () => {
    if (!currentProxyStr) return;
    navigator.clipboard.writeText(currentProxyStr).then(() => {
      const original = proxyInfoText.textContent;
      proxyInfoText.textContent = "📋 СКОПИРОВАНО!";
      setTimeout(() => proxyInfoText.textContent = original, 1200);
    });
  });

  function applySettings(s) {
    const body = document.body;
    if (s.bgEnabled === false) {
      body.style.backgroundImage = "none"; body.style.background = "#111"; body.classList.add("no-overlay");
    } else {
      body.classList.remove("no-overlay");
      const type = s.bgType || "bambi";
      if (type === "bambi") { body.style.backgroundImage = "url('images/Bambi.png')"; body.style.background = ""; }
      else if (type === "dark") { body.style.backgroundImage = "none"; body.style.background = "#111"; }
      else if (type === "gradient") { body.style.backgroundImage = "none"; body.style.background = "linear-gradient(135deg, #00ffff 0%, #ff64c8 100%)"; }
      else if (type === "matrix") { body.style.backgroundImage = "none"; body.style.background = "#000000"; body.style.color = "#00ff00"; }
    }
    if (s.showSites === false) sitesSection.style.display = "none";
    else sitesSection.style.display = "";
    if (s.protocolFilter) protocolSelect.value = s.protocolFilter;

    currentMode = s.siteMode || "whitelist";
    modeBadge.textContent = currentMode === "blacklist" ? "ЧЁРНЫЙ" : "БЕЛЫЙ";
    modeBadge.classList.toggle("black", currentMode === "blacklist");
  }

  function refreshStatus() {
    chrome.storage.local.get(["proxy", "proxyMs", "searchStatus", "searching"], (data) => {
      searching = !!data.searching;
      if (searching) {
        findButton.classList.add("stop-mode"); findButton.textContent = "СТОП"; findButton.disabled = false;
        toggleButton.classList.add("searching"); proxyInfoText.textContent = data.searchStatus || "ПОИСК...";
      } else {
        findButton.classList.remove("stop-mode"); findButton.textContent = "ИСКАТЬ ПРОКСИ"; findButton.disabled = false;
        toggleButton.classList.remove("searching");
        if (data.searchStatus) proxyInfoText.textContent = data.searchStatus;
        else if (data.proxy) {
          currentProxyStr = data.proxy.scheme + "://" + data.proxy.host + ":" + data.proxy.port;
          proxyInfoText.textContent = "✅ " + data.proxy.host + ":" + data.proxy.port + " — " + (data.proxyMs || "?") + "ms";
        } else {
          currentProxyStr = "";
          proxyInfoText.textContent = "Прокси не выбран";
        }
      }
    });
  }

  function refreshStats() { chrome.storage.local.get("stats", (data) => renderStats(data.stats || {})); }
  function renderStats(stats) {
    statSearches.textContent = stats.searches || 0; statTested.textContent = stats.tested || 0;
    statLive.textContent = stats.live || 0; statAvgPing.textContent = stats.pingCount > 0 ? Math.round(stats.pingSum / stats.pingCount) + "мс" : "—";
  }

  function renderCheckResult(res) {
    if (!res || Object.keys(res).length === 0) { checkResult.style.display = "none"; return; }
    checkResult.style.display = "";
    if (res.loading) { checkResult.className = "check-result"; checkResult.textContent = "ПРОВЕРЯЕМ..."; }
    else if (res.error) { checkResult.className = "check-result error"; checkResult.textContent = "❌ " + res.error; }
    else if (res.success) {
      checkResult.className = "check-result success";
      let cleanText = res.isClean ? "<br>🛡️ Чистый IP" : "<br>⚠️ В БЛЭКЛИСТЕ (СПАМ)";
      checkResult.innerHTML = "🌍 " + res.ip + " " + getFlagEmoji(res.country) + "<br>📍 " + res.country + "<br>⚡ " + res.ping + " мс" + cleanText;
    }
  }

  function renderSpeedResult(res) {
    if (!res || Object.keys(res).length === 0) { speedResult.style.display = "none"; return; }
    speedResult.style.display = "";
    if (res.loading) { speedResult.className = "check-result"; speedResult.textContent = "🚀 ЗАМЕРЯЕМ..."; }
    else if (res.error) { speedResult.className = "check-result error"; speedResult.textContent = "❌ " + res.error; }
    else if (res.success) { speedResult.className = "check-result success"; speedResult.textContent = "🚀 " + res.mbps + " Мбит/с (" + res.seconds + " сек)"; }
  }

  function renderTop(top) {
    if (!top || top.length === 0) { topSection.style.display = "none"; return; }
    topSection.style.display = ""; topList.innerHTML = "";
    top.forEach((item, idx) => {
      const row = document.createElement("div"); row.className = "top-item";
      const flag = getFlagEmoji(item.country);
      let cleanIcon = item.isClean ? "" : " ⚠️";
      row.innerHTML = "<span class='top-rank'>#" + (idx + 1) + "</span><span class='top-addr'>" + flag + " " + item.proxy.host + ":" + item.proxy.port + cleanIcon + "</span><span class='top-ping'>" + item.ms + "мс</span>";
      row.addEventListener("click", () => chrome.runtime.sendMessage({ action: "selectProxyFromTop", index: idx }));
      topList.appendChild(row);
    });
  }

  toggleButton.addEventListener("click", () => { 
    enabled = !enabled; 
    chrome.storage.sync.set({ enabled }); 
    updateUI(); 
    if (enabled) {
      playConnectSound();
      chrome.storage.local.get("proxy", (data) => {
        if (!data.proxy && !searching) {
          proxyInfoText.textContent = "НЕТ ПРОКСИ! АВТОПОИСК...";
          chrome.storage.sync.set({ source: sourceSelect.value });
          chrome.runtime.sendMessage({ action: "findBestProxy", source: sourceSelect.value });
        }
      });
    }
  });

  addSiteButton.addEventListener("click", () => {
    const site = siteInput.value.trim();
    if (!site) return;
    chrome.storage.sync.get({ sites: [] }, (data) => {
      const sites = Array.isArray(data.sites) ? data.sites : [];
      sites.push(site); chrome.storage.sync.set({ sites }, () => { addSiteToList(site); siteInput.value = ""; });
    });
  });

  sourceSelect.addEventListener("change", () => chrome.storage.sync.set({ source: sourceSelect.value }));
  protocolSelect.addEventListener("change", () => {
    chrome.storage.local.get("settings", (data) => {
      const s = Object.assign({}, data.settings || {}, { protocolFilter: protocolSelect.value });
      chrome.storage.local.set({ settings: s });
    });
  });

  findButton.addEventListener("click", () => {
    if (searching) { chrome.runtime.sendMessage({ action: "stopSearch" }); findButton.textContent = "ОСТАНОВКА..."; findButton.disabled = true; return; }
    chrome.storage.sync.set({ source: sourceSelect.value });
    chrome.runtime.sendMessage({ action: "findBestProxy", source: sourceSelect.value });
    findButton.classList.add("stop-mode"); findButton.textContent = "СТОП"; proxyInfoText.textContent = "ПОИСК...";
  });

  rotateButton.addEventListener("click", () => { chrome.runtime.sendMessage({ action: "rotateProxy" }); proxyInfoText.textContent = "🔄 СМЕНА..."; });
  pingButton.addEventListener("click", () => { chrome.runtime.sendMessage({ action: "checkCurrentProxy" }); checkResult.style.display = ""; checkResult.className = "check-result"; checkResult.textContent = "ПРОВЕРЯЕМ..."; });
  speedButton.addEventListener("click", () => { chrome.runtime.sendMessage({ action: "runSpeedTest" }); speedResult.style.display = ""; speedResult.className = "check-result"; speedResult.textContent = "🚀 ЗАМЕРЯЕМ..."; });
  settingsButton.addEventListener("click", () => chrome.runtime.openOptionsPage());
  
  // Обработчик для ссылки на Дзен
  devLink.addEventListener("click", (e) => { 
    e.preventDefault(); 
    window.open("https://dzen.ru/id/6801c825e350361bd658166b", "_blank"); 
  });

  function updateUI() { toggleButton.classList.toggle("enabled", enabled); statusText.classList.toggle("enabled", enabled); statusText.textContent = enabled ? "ВКЛЮЧЕНО" : "ВЫКЛЮЧЕНО"; }
  function addSiteToList(site) {
    const el = document.createElement("div"); el.className = "site-item";
    const txt = document.createElement("span"); txt.textContent = site; el.appendChild(txt);
    const removeBtn = document.createElement("button"); removeBtn.className = "site-remove"; removeBtn.textContent = "X";
    removeBtn.addEventListener("click", () => { chrome.storage.sync.get({ sites: [] }, (data) => { const sites = (data.sites || []).filter(s => s !== site); chrome.storage.sync.set({ sites }, () => el.remove()); }); });
    el.appendChild(removeBtn); siteList.appendChild(el);
  }
});