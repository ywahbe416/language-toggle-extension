const STORAGE_KEY = "page-language-toggle-state";
const DEFAULT_LANG = "fr";
const SUPPORTED_LANGS = new Set(["fr", "es", "it"]);

function parseHttpUrl(url) {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

function isGoogleDomain(hostname) {
  return hostname === "google.com" || hostname.endsWith(".google.com") || /^google\.[a-z.]+$/i.test(hostname);
}

function isTranslateProxyHost(hostname) {
  return hostname === "translate.goog" || hostname.endsWith(".translate.goog");
}

function isTranslatableUrl(url) {
  const parsed = parseHttpUrl(url);
  if (!parsed) {
    return false;
  }

  const host = parsed.hostname.toLowerCase();
  if (isGoogleDomain(host) || isTranslateProxyHost(host)) {
    return false;
  }

  return true;
}

function isGoogleTranslateUrl(url) {
  const parsed = parseHttpUrl(url);
  if (!parsed) {
    return false;
  }

  const host = parsed.hostname.toLowerCase();
  return (host === "translate.google.com" && parsed.pathname.startsWith("/translate")) || isTranslateProxyHost(host);
}

function buildTranslateUrl(originalUrl, targetLang) {
  const encoded = encodeURIComponent(originalUrl);
  return `https://translate.google.com/translate?sl=auto&tl=${targetLang}&u=${encoded}`;
}

function normalizeLanguage(lang) {
  return SUPPORTED_LANGS.has(lang) ? lang : DEFAULT_LANG;
}

function getOriginalUrlFromTranslateUrl(url) {
  try {
    const parsed = new URL(url);
    return parsed.searchParams.get("u");
  } catch {
    return null;
  }
}

async function readState() {
  const data = await chrome.storage.local.get(STORAGE_KEY);
  return data[STORAGE_KEY] || {};
}

async function writeState(state) {
  await chrome.storage.local.set({ [STORAGE_KEY]: state });
}

async function getTabState(tabId, currentUrl) {
  const allState = await readState();
  const tabState = allState[String(tabId)] || {};

  const unsupported = !isTranslatableUrl(currentUrl);

  tabState.targetLang = normalizeLanguage(tabState.targetLang);

  if (!tabState.originalUrl && currentUrl && !isGoogleTranslateUrl(currentUrl)) {
    tabState.originalUrl = currentUrl;
  }

  if (isGoogleTranslateUrl(currentUrl) && !tabState.originalUrl) {
    const extracted = getOriginalUrlFromTranslateUrl(currentUrl);
    if (extracted) {
      tabState.originalUrl = extracted;
      tabState.enabled = true;
    }
  }

  allState[String(tabId)] = tabState;
  await writeState(allState);

  return {
    unsupported,
    enabled: Boolean(tabState.enabled),
    targetLang: normalizeLanguage(tabState.targetLang),
  };
}

async function setTranslation(tabId, enabled, targetLang) {
  const tab = await chrome.tabs.get(tabId);
  const currentUrl = tab.url || "";

  if (!isTranslatableUrl(currentUrl) && !isGoogleTranslateUrl(currentUrl)) {
    return { ok: false, error: "This page cannot be translated (Google/Chrome pages are blocked)." };
  }

  const allState = await readState();
  const tabKey = String(tabId);
  const tabState = allState[tabKey] || { targetLang: DEFAULT_LANG };

  tabState.targetLang = normalizeLanguage(targetLang);

  if (enabled) {
    if (!tabState.originalUrl || isGoogleTranslateUrl(tabState.originalUrl)) {
      tabState.originalUrl = isGoogleTranslateUrl(currentUrl)
        ? getOriginalUrlFromTranslateUrl(currentUrl)
        : currentUrl;
    }

    if (!tabState.originalUrl) {
      return { ok: false, error: "Could not determine original URL." };
    }

    tabState.enabled = true;
    allState[tabKey] = tabState;
    await writeState(allState);

    const targetUrl = buildTranslateUrl(tabState.originalUrl, tabState.targetLang);
    await chrome.tabs.update(tabId, { url: targetUrl });
    return { ok: true };
  }

  tabState.enabled = false;
  allState[tabKey] = tabState;
  await writeState(allState);

  if (tabState.originalUrl) {
    await chrome.tabs.update(tabId, { url: tabState.originalUrl });
  }

  return { ok: true };
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "GET_TAB_STATE") {
    getTabState(message.tabId, message.currentUrl)
      .then((state) => sendResponse({ ok: true, state }))
      .catch(() => sendResponse({ ok: false }));
    return true;
  }

  if (message?.type === "SET_TRANSLATION") {
    setTranslation(message.tabId, message.enabled, message.targetLang)
      .then((result) => sendResponse(result))
      .catch(() => sendResponse({ ok: false, error: "Unexpected error." }));
    return true;
  }

  return false;
});

chrome.tabs.onRemoved.addListener(async (tabId) => {
  const allState = await readState();
  if (allState[String(tabId)]) {
    delete allState[String(tabId)];
    await writeState(allState);
  }
});
