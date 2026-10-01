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
  const [{ flowSceneDirectorFlowTabId } = {}, storedProject = {}] = await Promise.all([
    chrome.storage.session.get("flowSceneDirectorFlowTabId"),
    chrome.storage.local.get("flowSceneDirectorProject")
  ]);
  const activeTabs = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  const activeFlowTab = activeTabs.find((tab) => tab.id && isFlowUrl(tab.url));
  if (activeFlowTab && (!storedProject.flowSceneDirectorProject?.running || !flowSceneDirectorFlowTabId)) {
    await chrome.storage.session.set({ flowSceneDirectorFlowTabId: activeFlowTab.id });
    return activeFlowTab;
  }

  if (flowSceneDirectorFlowTabId) {
    const pinned = await chrome.tabs.get(flowSceneDirectorFlowTabId).catch(() => null);
    if (pinned?.id && isFlowUrl(pinned.url)) return pinned;
    if (storedProject.flowSceneDirectorProject?.running) return null;
    await chrome.storage.session.remove("flowSceneDirectorFlowTabId");
  }

  const tabs = await chrome.tabs.query({
    url: ["https://flow.google.com/*", "https://labs.google/fx/tools/flow/*"]
  });
  if (!tabs.length) return null;
  const lastFocused = await chrome.windows.getLastFocused().catch(() => null);
  const target = tabs
    .filter((tab) => tab.id && isFlowUrl(tab.url))
    .sort((a, b) => {
      const score = (tab) =>
        (tab.windowId === lastFocused?.id ? 100 : 0) +
        (tab.active ? 50 : 0) +
        ((tab.lastAccessed || 0) / 1e13);
      return score(b) - score(a);
    })[0] || null;
  if (target?.id) await chrome.storage.session.set({ flowSceneDirectorFlowTabId: target.id });
  return target;
}

async function saveCompletedKeyframe(message) {
  if (!message?.keyframe?.data || !message.sceneId) return;
  const { flowSceneDirectorProject } = await chrome.storage.local.get("flowSceneDirectorProject");
  if (!flowSceneDirectorProject?.scenes) return;
  const scene = flowSceneDirectorProject.scenes.find((entry) => entry.id === message.sceneId);
  if (!scene) return;
  scene.keyframe = message.keyframe;
  scene.status = "done";
  scene.note = "Đã tạo video và lưu keyframe cuối @last_keyframe.";
  flowSceneDirectorProject.statusMessage = message.message || `Hoàn tất ${scene.title || `cảnh ${scene.sceneNumber || ""}`} và lưu keyframe.`;
  await chrome.storage.local.set({ flowSceneDirectorProject });
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
    (async () => {
      if (message.type === "FLOW_STATUS" && message.status === "scene-done") await saveCompletedKeyframe(message);
      chrome.runtime.sendMessage(message).catch(() => {});
      sendResponse({ ok: true });
    })().catch((error) => {
      const failure = { type: "FLOW_ERROR", sceneId: message.sceneId, code: "KEYFRAME_SAVE_FAILED", message: `Video đã hoàn tất nhưng không lưu được @last_keyframe. ${error?.message || "Hãy kiểm tra dung lượng bộ nhớ extension."}` };
      chrome.runtime.sendMessage(failure).catch(() => {});
      sendResponse({ ok: false, error: failure.message });
    });
    return true;
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

chrome.tabs.onRemoved.addListener(async (tabId) => {
  const [{ flowSceneDirectorFlowTabId }, { flowSceneDirectorProject }] = await Promise.all([
    chrome.storage.session.get("flowSceneDirectorFlowTabId"),
    chrome.storage.local.get("flowSceneDirectorProject")
  ]);
  if (flowSceneDirectorFlowTabId === tabId && !flowSceneDirectorProject?.running) await chrome.storage.session.remove("flowSceneDirectorFlowTabId");
});
