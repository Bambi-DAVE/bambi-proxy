const GEO_URL = "https://api.myip.com";
const BATCH_GEO_URL = "http://ip-api.com/batch?fields=query,countryCode";
const SPEED_URL = "https://speed.cloudflare.com/__down?bytes=500000";
const TIME_BUDGET_MS = 180000;

const DEFAULT_SETTINGS = {
  bgEnabled: true, bgType: "bambi", testTimeout: 1500, maxCandidates: 500,
  autoFind: false, autoApply: true, showSites: true, pingQuality: "medium",
  customPingMs: 800, manualProxy: "", protocolFilter: "all", siteMode: "whitelist",
  countryMode: "all", countryList: [], autoCheck: false, autoCheckInterval: 5,
  rotateInterval: 0, webrtcProtect: true, soundEnabled: true,
  dohEnabled: true, autoStart: false, ipSource: "ipify"
};

const DEFAULT_STATS = { searches: 0, tested: 0, live: 0, pingSum: 0, pingCount: 0, lastSearchAt: 0 };
let proxyAuth = null;

// ГЛОБАЛЬНЫЕ ФЛАГИ ДЛЯ ОСТАНОВКИ
let stopRequested = false;
let currentAbortController = null;

const SOURCES = {
  proxyscrape: async () => {
    const url = "https://api.proxyscrape.com/v4/free-proxy-list/get?request=display_proxies&proxy_format=protocolipport&format=text";
    const res = await fetch(url, { cache: "no-store" });
    const text = await res.text();
    return text.split("\n").map(s => s.trim()).filter(Boolean).map(parseProtocolIpPort).filter(Boolean);
  },
  geonode: async () => {
    const url = "https://proxylist.geonode.com/api/proxy-list?limit=500&page=1&sort_by=lastChecked&sort_type=desc&protocols=socks4%2Csocks5%2Chttp";
    const res = await fetch(url, { cache: "no-store" });
    const data = await res.json();
    const list = [];
    (data.data || []).forEach(item => {
      if (!item.ip || !item.port) return;
      const proto = (item.protocols && item.protocols[0]) || "http";
      list.push({ scheme: normalizeScheme(proto), host: item.ip, port: parseInt(item.port, 10) });
    });
    return list;
  },
  proxylist: async () => {
    const result = [];
    const types = ["socks4", "socks5", "http"];
    for (const t of types) {
      try {
        const res = await fetch("https://www.proxy-list.download/api/v1/get?type=" + t, { cache: "no-store" });
        const text = await res.text();
        text.split("\n").map(s => s.trim()).filter(Boolean).forEach(line => {
          const m = line.match(/^([\d.]+):(\d+)$/);
          if (m) result.push({ scheme: t, host: m[1], port: parseInt(m[2], 10) });
        });
      } catch (e) {}
    }
    return result;
  },
  speedx: async () => {
    const result = [];
    const files = ["socks4", "socks5", "http"];
    for (const f of files) {
      try {
        const res = await fetch("https://raw.githubusercontent.com/TheSpeedX/PROXY-List/master/" + f + ".txt", { cache: "no-store" });
        const text = await res.text();
        text.split("\n").map(s => s.trim()).filter(Boolean).forEach(line => {
          const m = line.match(/^([\d.]+):(\d+)$/);
          if (m) result.push({ scheme: f, host: m[1], port: parseInt(m[2], 10) });
        });
      } catch (e) {}
    }
    return result;
  }
};

function normalizeScheme(s) {
  s = (s || "").toLowerCase();
  if (s === "socks5" || s === "socks4" || s === "http" || s === "https") return s;
  if (s.indexOf("socks5") >= 0) return "socks5";
  if (s.indexOf("socks4") >= 0) return "socks4";
  return "http";
}

function parseProtocolIpPort(str) {
  const m = str.match(/^(socks4|socks5|http|https):\/\/(?:([^:]+):([^@]+)@)?([\d.]+):(\d+)$/);
  if (!m) return null;
  const res = { scheme: m[1], host: m[4], port: parseInt(m[5], 10) };
  if (m[2] && m[3]) { res.username = m[2]; res.password = m[3]; }
  return res;
}

function proxyKey(p) { return p.scheme + "://" + p.host + ":" + p.port; }

function generatePac(proxy, sites, mode) {
  const proto = proxy.scheme === "socks5" ? "SOCKS5" : proxy.scheme === "socks4" ? "SOCKS" : "PROXY";
  const proxyStr = proto + " " + proxy.host + ":" + proxy.port;
  const cleanSites = sites.map(s => String(s).trim().toLowerCase()).filter(Boolean).map(s => s.replace(/^https?:\/\//, "").replace(/\/.*$/, ""));
  const isBlack = mode === "blacklist";
  let rulesJs = "";
  cleanSites.forEach(s => {
    if (s.includes("*")) {
      const regexStr = s.replace(/\./g, "\\.").replace(/\*/g, ".*");
      rulesJs += "      if (new RegExp('^" + regexStr + "$').test(host)) { inList = true; }\n";
    } else {
      rulesJs += "      if (host === '" + s + "' || host.endsWith('." + s + "') || host.indexOf('" + s + "') !== -1) { inList = true; }\n";
    }
  });
  return "function FindProxyForURL(url, host) {\n  host = host.toLowerCase();\n  var inList = false;\n  if (!inList) {\n" + rulesJs + "  }\n  var useProxy = " + (isBlack ? "!inList" : "inList") + ";\n  return useProxy ? \"" + proxyStr + "\" : \"DIRECT\";\n}";
}

async function applyProxy(proxy, sites, siteMode) {
  if (proxy.username && proxy.password) proxyAuth = { username: proxy.username, password: proxy.password };
  else proxyAuth = null;

  return new Promise((resolve) => {
    if (sites && sites.length > 0) {
      const pacData = generatePac(proxy, sites, siteMode || "whitelist");
      chrome.proxy.settings.set({ value: { mode: "pac_script", pacScript: { data: pacData } }, scope: "regular" }, () => resolve(!chrome.runtime.lastError));
    } else {
      chrome.proxy.settings.set({ value: { mode: "fixed_servers", rules: { singleProxy: { scheme: proxy.scheme, host: proxy.host, port: proxy.port }, bypassList: ["localhost", "127.0.0.1", "<local>"] } }, scope: "regular" }, () => resolve(!chrome.runtime.lastError));
    }
  });
}

function applyTestProxy(proxy) {
  if (proxy.username && proxy.password) proxyAuth = { username: proxy.username, password: proxy.password };
  else proxyAuth = null;

  return new Promise((resolve) => {
    const proto = proxy.scheme === "socks5" ? "SOCKS5" : proxy.scheme === "socks4" ? "SOCKS" : "PROXY";
    const proxyStr = proto + " " + proxy.host + ":" + proxy.port;
    
    const pacData = "function FindProxyForURL(url, host) {\n" +
      "  if (host.indexOf('ipify.org') !== -1 || host.indexOf('ip-api.com') !== -1 || host.indexOf('myip.com') !== -1 || host.indexOf('cloudflare.com') !== -1) {\n" +
      "    return \"" + proxyStr + "\";\n" +
      "  }\n" +
      "  return \"DIRECT\";\n" +
      "}";
      
    chrome.proxy.settings.set({ value: { mode: "pac_script", pacScript: { data: pacData } }, scope: "regular" }, () => resolve(!chrome.runtime.lastError));
  });
}

async function clearProxy() { 
  proxyAuth = null;
  return new Promise((resolve) => { chrome.proxy.settings.clear({ scope: "regular" }, () => resolve()); }); 
}

chrome.webRequest.onAuthRequired.addListener(
  (details, callback) => {
    if (details.isProxy && proxyAuth) callback({ authCredentials: proxyAuth });
    else callback();
  },
  { urls: ["<all_urls>"] },
  ["asyncBlocking"]
);

async function getSettings() { return new Promise(r => chrome.storage.local.get("settings", d => r(Object.assign({}, DEFAULT_SETTINGS, d.settings || {})))); }
async function getSites() { return new Promise(r => chrome.storage.sync.get({ sites: [] }, d => r(Array.isArray(d.sites) ? d.sites : []))); }
async function getStats() { return new Promise(r => chrome.storage.local.get("stats", d => r(Object.assign({}, DEFAULT_STATS, d.stats || {})))); }

function getTestUrl(source) {
  if (source === "myip") return "https://api.myip.com";
  if (source === "ip-api") return "http://ip-api.com/json?fields=query";
  return "https://api.ipify.org?format=json";
}

async function restoreProxyState() {
  const syncData = await new Promise(r => chrome.storage.sync.get({ enabled: false }, r));
  const settings = await getSettings();

  if (syncData.enabled) {
    const localData = await new Promise(r => chrome.storage.local.get("proxy", r));
    if (localData.proxy) {
      const sites = await getSites();
      await applyProxy(localData.proxy, sites, settings.siteMode);
    } else {
      await clearProxy();
    }
    if (settings.webrtcProtect) { try { chrome.privacy.network.webRTCIPHandlingPolicy.set({ value: 'disable_non_proxied_udp' }); } catch (e) {} }
  } else {
    await clearProxy();
    try { chrome.privacy.network.webRTCIPHandlingPolicy.clear({}); } catch (e) {}
  }
}

async function rotateToNextProxy(reason) {
  const localData = await chrome.storage.local.get(["proxy", "topProxies"]);
  const top = localData.topProxies || [];
  if (top.length <= 1) return false;
  let currIdx = top.findIndex(t => t.proxy.host === localData.proxy.host && t.proxy.port === localData.proxy.port);
  let nextIdx = (currIdx + 1) % top.length;
  let nextProxy = top[nextIdx];
  await chrome.storage.local.set({ proxy: nextProxy.proxy, proxyMs: nextProxy.ms, proxyIp: nextProxy.ip });
  await restoreProxyState();
  await notify("Bambi Proxy", (reason || "🔄 Смена") + ": " + nextProxy.proxy.host, true);
  return true;
}

function scheduleRotate(settings) {
  chrome.alarms.clear("rotateProxy", () => {
    if (settings.rotateInterval > 0) chrome.alarms.create("rotateProxy", { periodInMinutes: settings.rotateInterval });
  });
}

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === "autoCheckProxy") {
    const localData = await new Promise(r => chrome.storage.local.get("proxy", r));
    if (!localData.proxy) return;
    const syncData = await new Promise(r => chrome.storage.sync.get({ enabled: false }, r));
    if (!syncData.enabled) return;
    const settings = await getSettings();
    
    await applyTestProxy(localData.proxy);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 6000);
    try {
      const res = await fetch(getTestUrl(settings.ipSource), { signal: controller.signal, cache: "no-store" });
      clearTimeout(timer);
      if (!res.ok) throw new Error("not ok");
    } catch (e) {
      clearTimeout(timer);
      const rotated = await rotateToNextProxy("⚠ Прокси умер. Переключено");
      if (!rotated) await notify("Bambi Proxy", "⚠ Прокси не отвечает!", true);
    } finally { 
      await restoreProxyState(); 
    }
  }
  if (alarm.name === "rotateProxy") {
    const syncData = await new Promise(r => chrome.storage.sync.get({ enabled: false }, r));
    if (syncData.enabled) await rotateToNextProxy("⏱ Плановая смена");
  }
});

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({ id: "bambi-add-site", title: "Добавить в Bambi Proxy", contexts: ["link", "page"] });
  chrome.storage.sync.get(["sites", "enabled", "source"], (data) => {
    if (data.sites === undefined) chrome.storage.sync.set({ sites: [] });
    if (data.enabled === undefined) chrome.storage.sync.set({ enabled: false });
  });
  chrome.storage.local.get(["settings", "stats"], (data) => {
    if (!data.settings) chrome.storage.local.set({ settings: DEFAULT_SETTINGS });
    if (!data.stats) chrome.storage.local.set({ stats: DEFAULT_STATS });
  });
  chrome.storage.local.set({ stopRequested: false, searching: false });
  getSettings().then(s => { scheduleAutoCheck(s); scheduleRotate(s); });
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === "bambi-add-site") {
    let url = info.linkUrl || info.pageUrl;
    if (url) {
      try {
        const domain = new URL(url).hostname;
        chrome.storage.sync.get({ sites: [] }, (data) => {
          const sites = Array.isArray(data.sites) ? data.sites : [];
          if (!sites.includes(domain)) { sites.push(domain); chrome.storage.sync.set({ sites }); notify("Bambi Proxy", "Добавлено: " + domain, true); }
          else notify("Bambi Proxy", "Уже в списке: " + domain, true);
        });
      } catch (e) {}
    }
  }
});

async function notify(title, message, force) {
  const sync = await new Promise(r => chrome.storage.sync.get({ enabled: false }, r));
  if (!sync.enabled && !force) return;
  try { chrome.notifications.create("bambi-" + Date.now(), { type: "basic", iconUrl: "images/Bambi.png", title, message, priority: 1 }); } catch (e) {}
}

chrome.runtime.onStartup.addListener(async () => {
  const settings = await getSettings();
  if (settings.autoStart) await chrome.storage.sync.set({ enabled: true });
  const syncData = await new Promise(r => chrome.storage.sync.get({ enabled: false }, r));
  if (syncData.enabled && settings.autoApply) await restoreProxyState();
  if (settings.autoFind) findBestProxy("all");
  scheduleAutoCheck(settings); scheduleRotate(settings);
});

chrome.commands.onCommand.addListener(async (command) => {
  if (command === "toggle-proxy") {
    const data = await new Promise(r => chrome.storage.sync.get({ enabled: false }, r));
    await chrome.storage.sync.set({ enabled: !data.enabled });
    await restoreProxyState();
    await notify("Bambi Proxy", !data.enabled ? "✅ Прокси ВКЛ" : "⏸ Прокси ВЫКЛ", true);
  }
});

chrome.storage.onChanged.addListener(async (changes, area) => {
  if (area === "sync" && (changes.sites || changes.enabled)) await restoreProxyState();
  if (area === "local" && changes.settings) {
    const settings = await getSettings();
    scheduleAutoCheck(settings); scheduleRotate(settings);
    await restoreProxyState();
  }
});

// ОГРАНИЧЕНИЕ ЗАПИСИ В ХРАНИЛИЩЕ (Чтобы не было ошибки Quota)
let lastStatusUpdate = 0;
async function setStatus(text, searching) { 
  const now = Date.now();
  if (!searching || now - lastStatusUpdate > 300) {
    lastStatusUpdate = now;
    await chrome.storage.local.set({ searchStatus: text, searching: !!searching });
  }
}

// ============ БЕЗОПАСНЫЕ ТЕСТЫ С ОБРЫВОМ ============
async function quickCheck(proxy, timeoutMs) {
  if (stopRequested) return false;
  const ok = await applyTestProxy(proxy);
  if (!ok || stopRequested) return false;
  
  currentAbortController = new AbortController();
  const timer = setTimeout(() => { if (currentAbortController) currentAbortController.abort(); }, timeoutMs);
  
  try {
    const res = await fetch("http://ip-api.com/json/?fields=query", { signal: currentAbortController.signal, cache: "no-store" });
    clearTimeout(timer); 
    return res.ok;
  } catch (e) { 
    clearTimeout(timer); 
    return false; 
  } finally {
    currentAbortController = null;
  }
}

async function fullCheck(proxy, timeoutMs, ipSource) {
  if (stopRequested) return null;
  const ok = await applyTestProxy(proxy);
  if (!ok || stopRequested) return null;
  
  currentAbortController = new AbortController();
  const timer = setTimeout(() => { if (currentAbortController) currentAbortController.abort(); }, timeoutMs);
  const started = Date.now();
  
  try {
    const res = await fetch(getTestUrl(ipSource), { signal: currentAbortController.signal, cache: "no-store" });
    clearTimeout(timer);
    if (!res.ok) return null;
    const data = await res.json();
    
    let ip = null;
    if (data.ip) ip = data.ip;
    else if (data.query) ip = data.query;
    
    if (!ip) return null;

    let isClean = true;
    try {
      const blRes = await fetch("http://ip-api.com/json/" + ip + "?fields=proxy,hosting");
      if (blRes.ok) { const blData = await blRes.json(); if (blData.proxy || blData.hosting) isClean = false; }
    } catch (e) {}

    return { proxy, ms: Date.now() - started, ip: ip, isClean };
  } catch (e) { 
    clearTimeout(timer); 
    return null; 
  } finally {
    currentAbortController = null;
  }
}

async function speedTest(proxy) {
  const ok = await applyTestProxy(proxy);
  if (!ok) return null;
  
  currentAbortController = new AbortController();
  const timer = setTimeout(() => { if (currentAbortController) currentAbortController.abort(); }, 20000);
  const started = Date.now();
  
  try {
    const res = await fetch(SPEED_URL + "&r=" + Math.random(), { signal: currentAbortController.signal, cache: "no-store" });
    clearTimeout(timer);
    if (!res.ok) return null;
    const buf = await res.arrayBuffer();
    const elapsed = (Date.now() - started) / 1000;
    return { mbps: parseFloat(((buf.byteLength * 8) / elapsed / 1000000).toFixed(2)), seconds: parseFloat(elapsed.toFixed(2)) };
  } catch (e) { 
    clearTimeout(timer); 
    return null; 
  } finally {
    currentAbortController = null;
  }
}

async function batchCountryLookup(ips) {
  const result = {};
  const chunks = [];
  for (let i = 0; i < ips.length; i += 100) chunks.push(ips.slice(i, i + 100));
  for (const chunk of chunks) {
    try {
      const res = await fetch(BATCH_GEO_URL, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(chunk), cache: "no-store" });
      if (res.ok) { const data = await res.json(); (data || []).forEach(item => { if (item && item.query && item.countryCode) result[item.query] = item.countryCode; }); }
    } catch (e) {}
  }
  return result;
}

async function findBestProxy(sourceKey) {
  const current = await chrome.storage.local.get("searching");
  if (current.searching) return;
  
  stopRequested = false;
  await chrome.storage.local.set({ stopRequested: false });

  const settings = await getSettings();
  const timeout = settings.testTimeout || 1500;
  const maxCand = settings.maxCandidates || 500;
  const protoFilter = settings.protocolFilter || "all";
  const countryMode = settings.countryMode || "all";
  const countryList = (settings.countryList || []).map(c => String(c).toUpperCase());

  let targetMs = settings.pingQuality === "custom" ? settings.customPingMs : ({ excellent: 300, good: 600, medium: 1200, bad: 3000 }[settings.pingQuality] || 1200);
  const startedAt = Date.now();
  await setStatus("Загружаю список...", true);

  try {
    let list = [];
    if (sourceKey === "all" || !sourceKey) {
      for (const k of Object.keys(SOURCES)) {
        if (stopRequested) break;
        await setStatus("Загружаю " + k + "...", true);
        try { list = list.concat(await SOURCES[k]()); } catch (e) {}
      }
    } else if (SOURCES[sourceKey]) {
      try { list = await SOURCES[sourceKey](); } catch (e) {}
    }

    if (stopRequested) { await setStatus("Остановлено", false); return; }
    if (protoFilter !== "all") list = list.filter(p => p.scheme === protoFilter);
    
    const seen = new Set();
    list = list.filter(p => { const k = proxyKey(p); if (seen.has(k)) return false; seen.add(k); return true; });
    if (list.length === 0) { await setStatus("Нет прокси", false); return; }

    let geoMap = {};
    if (countryMode !== "all" && countryList.length > 0) {
      await setStatus("Фильтр стран...", true);
      const ips = Array.from(new Set(list.map(p => p.host))).slice(0, 1500);
      geoMap = await batchCountryLookup(ips);
      if (stopRequested) { await setStatus("Остановлено", false); return; }
      list = list.filter(p => {
        const cc = geoMap[p.host];
        if (!cc) return countryMode === "deny";
        if (countryMode === "allow") return countryList.indexOf(cc) !== -1;
        return countryList.indexOf(cc) === -1;
      });
      if (list.length === 0) { await setStatus("Фильтр отсёк всё", false); return; }
    }

    await setStatus("Проверяю " + list.length + " прокси...", true);
    const candidates = list.sort(() => Math.random() - 0.5).slice(0, maxCand);

    let best = null, top = [], liveCount = 0, tested = 0, quickPassed = 0, wasStopped = false;

    for (let i = 0; i < candidates.length; i++) {
      if (Date.now() - startedAt > TIME_BUDGET_MS) break;
      if (stopRequested) { wasStopped = true; break; }
      
      tested = i + 1;
      const p = candidates[i];
      
      const quick = await quickCheck(p, 800);
      if (stopRequested) { wasStopped = true; break; }
      if (!quick) { 
        if (i % 5 === 0) await setStatus("Тест " + tested + "/" + candidates.length + " • живых: " + liveCount, true); 
        continue; 
      }
      quickPassed++;

      const result = await fullCheck(p, timeout, settings.ipSource);
      if (stopRequested) { wasStopped = true; break; }
      
      if (result) {
        liveCount++;
        result.country = geoMap[p.host] || null;
        top.push(result);
        top.sort((a, b) => a.ms - b.ms);
        if (top.length > 10) top = top.slice(0, 10);
        if (!best || result.ms < best.ms) best = result;
        await setStatus("Живых: " + liveCount + " • топ: " + top[0].ms + "мс", true);
        if (result.ms < targetMs) break;
      }
    }

    const stats = await getStats();
    await chrome.storage.local.set({ stats: { searches: stats.searches + 1, tested: stats.tested + tested, live: stats.live + liveCount, pingSum: stats.pingSum + (best ? best.ms : 0), pingCount: stats.pingCount + (best ? 1 : 0), lastSearchAt: Date.now() } });

    if (best) {
      await chrome.storage.local.set({ proxy: best.proxy, proxyMs: best.ms, proxyIp: best.ip, topProxies: top });
      const prefix = wasStopped ? "Стоп. Лучший: " : (best.ms < targetMs ? "OK: " : "Лучший: ");
      await setStatus(prefix + best.proxy.host + ":" + best.proxy.port + " — " + best.ms + "ms", false);
      await notify("Bambi Proxy", "Найден: " + best.proxy.host + ":" + best.proxy.port, false);
    } else {
      await setStatus(wasStopped ? "Остановлено. Живых: 0" : "Живых нет.", false);
      await notify("Bambi Proxy", "Прокси не найден.", false);
    }
  } catch (e) { 
    await setStatus("Ошибка: " + e.message, false); 
  } finally { 
    stopRequested = false;
    await chrome.storage.local.set({ stopRequested: false });
    await chrome.storage.local.set({ searching: false }); // Жестко сбрасываем поиск
    try { await restoreProxyState(); } catch(e) {}
  }
}

async function checkCurrentProxy() {
  const localData = await chrome.storage.local.get("proxy");
  if (!localData.proxy) { await chrome.storage.local.set({ checkResult: { error: "Прокси не выбран" } }); return; }
  const proxy = localData.proxy;
  const settings = await getSettings();
  await chrome.storage.local.set({ checkResult: { loading: true } });
  
  await applyTestProxy(proxy);

  const pings = []; let ip = null, country = null, isClean = true;
  for (let i = 0; i < 3; i++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);
    const started = Date.now();
    try {
      const res = await fetch(getTestUrl(settings.ipSource), { signal: controller.signal, cache: "no-store" });
      clearTimeout(timer);
      if (res.ok) { 
        const data = await res.json(); 
        let currIp = data.ip || data.query;
        if (currIp) { ip = currIp; pings.push(Date.now() - started); }
      }
    } catch (e) { clearTimeout(timer); }
  }
  if (pings.length === 0) { await chrome.storage.local.set({ checkResult: { error: "Прокси не отвечает", proxy } }); } 
  else {
    try { 
      const blRes = await fetch("http://ip-api.com/json/" + ip + "?fields=proxy,hosting");
      if (blRes.ok) { const blData = await blRes.json(); if (blData.proxy || blData.hosting) isClean = false; }
    } catch (e) {}
    try { const res = await fetch(GEO_URL + "?r=" + Math.random(), { cache: "no-store" }); if (res.ok) { const d = await res.json(); if (d && d.country) country = d.country; } } catch (e) {}
    await chrome.storage.local.set({ checkResult: { success: true, ip, country: country || "?", ping: Math.round(pings.reduce((a, b) => a + b, 0) / pings.length), pingMin: Math.min.apply(null, pings), pingMax: Math.max.apply(null, pings), proxy, isClean } });
  }
  await restoreProxyState();
}

async function runSpeedTest() {
  const localData = await chrome.storage.local.get("proxy");
  if (!localData.proxy) { await chrome.storage.local.set({ speedResult: { error: "Прокси не выбран" } }); return; }
  await chrome.storage.local.set({ speedResult: { loading: true } });
  await applyTestProxy(localData.proxy);
  const r = await speedTest(localData.proxy);
  await chrome.storage.local.set({ speedResult: r ? { success: true, mbps: r.mbps, seconds: r.seconds } : { error: "Не удалось" } });
  await restoreProxyState();
}

async function applyManualProxy() {
  const settings = await getSettings();
  const raw = (settings.manualProxy || "").trim();
  if (!raw) { await setStatus("Нет прокси", false); return; }
  let proxy = null;
  let m = raw.match(/^(socks5|socks4|http|https):\/\/(?:([^:]+):([^@]+)@)?([\d.]+):(\d+)$/);
  if (m) { proxy = { scheme: m[1], host: m[4], port: parseInt(m[5], 10) }; if (m[2] && m[3]) { proxy.username = m[2]; proxy.password = m[3]; } }
  if (!proxy) { m = raw.match(/^([\d.]+):(\d+)(?::(socks5|socks4|http|https))?$/); if (m) proxy = { scheme: m[3] || "http", host: m[1], port: parseInt(m[2], 10) }; }
  if (!proxy) { await setStatus("Неверный формат", false); return; }
  await setStatus("Проверяю...", true);
  const result = await fullCheck(proxy, 6000, settings.ipSource);
  if (result) {
    await chrome.storage.local.set({ proxy: result.proxy, proxyMs: result.ms, proxyIp: result.ip });
    await setStatus("OK: " + result.proxy.host + ":" + result.proxy.port + " — " + result.ms + "ms", false);
  } else { await setStatus("Прокси не работает", false); }
  await restoreProxyState();
}

async function selectProxyFromTop(index) {
  const data = await chrome.storage.local.get("topProxies");
  const top = data.topProxies || [];
  if (!top[index]) return;
  const chosen = top[index];
  await chrome.storage.local.set({ proxy: chosen.proxy, proxyMs: chosen.ms, proxyIp: chosen.ip });
  await setStatus("Выбран: " + chosen.proxy.host + ":" + chosen.proxy.port + " — " + chosen.ms + "ms", false);
  await restoreProxyState();
}

async function clearAllData() {
  await clearProxy();
  await chrome.storage.sync.clear();
  await chrome.storage.local.clear();
  await chrome.storage.sync.set({ sites: [], enabled: false, source: "all" });
  await chrome.storage.local.set({ settings: DEFAULT_SETTINGS, stats: DEFAULT_STATS });
  await notify("Bambi Proxy", "🗑 Все данные стерты.", true);
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg) return;
  if (msg.action === "findBestProxy") { findBestProxy(msg.source); sendResponse({ started: true }); return true; }
  if (msg.action === "stopSearch") { 
    stopRequested = true; 
    if (currentAbortController) currentAbortController.abort(); // МГНОВЕННЫЙ ОБРЫВ ЗАПРОСА
    chrome.storage.local.set({ stopRequested: true }, () => sendResponse({ stopped: true })); 
    return true; 
  }
  if (msg.action === "applyManualProxy") { applyManualProxy(); sendResponse({ started: true }); return true; }
  if (msg.action === "checkCurrentProxy") { checkCurrentProxy(); sendResponse({ started: true }); return true; }
  if (msg.action === "runSpeedTest") { runSpeedTest(); sendResponse({ started: true }); return true; }
  if (msg.action === "selectProxyFromTop") { selectProxyFromTop(msg.index); sendResponse({ ok: true }); return true; }
  if (msg.action === "clearAllData") { clearAllData(); sendResponse({ ok: true }); return true; }
  if (msg.action === "rotateProxy") { rotateToNextProxy("🔄 Вручную"); sendResponse({ ok: true }); return true; }
});