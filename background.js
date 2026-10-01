chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
});

const FLOW_URL_PREFIXES = [
  "https://labs.google/fx/tools/flow/",
  "https://flow.google.com/"
];

function isFlowUrl(url = "") {
  return FLOW_URL_PREFIXES.some((prefix) => url.startsWith(prefix));
}

async function findFlowTab() {
  const tabs = await chrome.tabs.query({
    url: ["https://flow.google.com/*", "https://labs.google/fx/tools/flow/*"]
  });
  if (!tabs.length) return null;
  const lastFocused = await chrome.windows.getLastFocused().catch(() => null);
  return tabs
    .filter((tab) => tab.id && isFlowUrl(tab.url))
    .sort((a, b) => {
      const score = (tab) =>
        (tab.windowId === lastFocused?.id ? 100 : 0) +
        (tab.active ? 50 : 0) +
        ((tab.lastAccessed || 0) / 1e13);
      return score(b) - score(a);
    })[0] || null;
}

async function findPromptFrame(tabId) {
  const frames = await chrome.scripting.executeScript({
    target: { tabId, allFrames: true },
    func: () => {
      const selector = 'textarea, input[type="text"], [contenteditable="true"], [role="textbox"]';
      const collect = (root) => {
        const found = [...root.querySelectorAll(selector)];
        for (const element of root.querySelectorAll("*")) {
          if (element.shadowRoot) found.push(...collect(element.shadowRoot));
        }
        return found;
      };
      const candidates = collect(document);
      return candidates.some((element) => {
        const rect = element.getBoundingClientRect();
        const hint = `${element.getAttribute("placeholder") || ""} ${element.getAttribute("aria-label") || ""}`.toLowerCase();
        return rect.width > 250 && rect.height > 20 && !element.closest('[aria-hidden="true"]') &&
          (/prompt|describe|ask|what do you want to create/.test(hint) || element.matches("textarea, [contenteditable=true]"));
      });
    }
  });
  return frames.find((frame) => frame.result)?.frameId ?? 0;
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if ((message?.type === "FLOW_STATUS" || message?.type === "FLOW_ERROR") && sender.tab) {
    chrome.runtime.sendMessage(message).catch(() => {});
    return;
  }

  if (message?.type === "FLOW_COMMAND") {
    (async () => {
      const tab = await findFlowTab();
      if (!tab?.id || !isFlowUrl(tab.url)) {
        sendResponse({ ok: false, error: "Mở một project Google Flow trước." });
        return;
      }
      try {
        const frameId = await findPromptFrame(tab.id);
        const response = await chrome.tabs.sendMessage(tab.id, message.command, { frameId });
        sendResponse(response || { ok: false, error: "Flow không phản hồi lệnh." });
      } catch (error) {
        sendResponse({ ok: false, error: `Không kết nối được với Flow. Hãy tải lại tab Flow. (${error?.message || "unknown"})` });
      }
    })().catch((error) => sendResponse({ ok: false, error: error?.message || "Không tìm thấy tab Flow." }));
    return true;
  }
});
