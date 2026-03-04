const enabledToggle = document.getElementById("enabledToggle");
const languageSelect = document.getElementById("languageSelect");
const statusText = document.getElementById("statusText");
const SUPPORTED_LANGS = new Set(["fr", "es", "it"]);

let activeTabId = null;

function setStatus(message) {
  statusText.textContent = message;
}

function normalizeLanguage(lang) {
  return SUPPORTED_LANGS.has(lang) ? lang : "fr";
}

async function getActiveTab() {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  return tabs[0] ?? null;
}

async function loadState() {
  const tab = await getActiveTab();
  if (!tab || typeof tab.id !== "number" || !tab.url) {
    enabledToggle.disabled = true;
    languageSelect.disabled = true;
    setStatus("No active page found.");
    return;
  }

  activeTabId = tab.id;

  const response = await chrome.runtime.sendMessage({
    type: "GET_TAB_STATE",
    tabId: activeTabId,
    currentUrl: tab.url,
  });

  if (!response?.ok) {
    enabledToggle.disabled = true;
    languageSelect.disabled = true;
    setStatus("This page cannot be translated.");
    return;
  }

  enabledToggle.checked = Boolean(response.state?.enabled);
  languageSelect.value = normalizeLanguage(response.state?.targetLang || "fr");

  const isSpecialPage = response.state?.unsupported;
  enabledToggle.disabled = isSpecialPage;
  languageSelect.disabled = isSpecialPage;

  if (isSpecialPage) {
    setStatus("Chrome internal pages are unsupported.");
    return;
  }

  setStatus(enabledToggle.checked ? "Translation is ON." : "Translation is OFF.");
}

async function updateTranslation() {
  if (activeTabId === null) {
    return;
  }

  const result = await chrome.runtime.sendMessage({
    type: "SET_TRANSLATION",
    tabId: activeTabId,
    enabled: enabledToggle.checked,
    targetLang: normalizeLanguage(languageSelect.value),
  });

  if (!result?.ok) {
    setStatus(result?.error || "Could not update translation.");
    return;
  }

  setStatus(enabledToggle.checked ? "Translation is ON." : "Translation is OFF.");
  window.close();
}

enabledToggle.addEventListener("change", updateTranslation);
languageSelect.addEventListener("change", async () => {
  if (!enabledToggle.checked) {
    setStatus(`Language set to ${languageSelect.options[languageSelect.selectedIndex].text}.`);
    return;
  }
  await updateTranslation();
});

loadState().catch(() => {
  setStatus("Failed to load extension state.");
});
