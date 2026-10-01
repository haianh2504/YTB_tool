const textOf = (node) => (node?.innerText || node?.getAttribute?.("aria-label") || "").trim();

function queryAllDeep(selector, root = document) {
  const matches = [...root.querySelectorAll(selector)];
  for (const element of root.querySelectorAll("*")) {
    if (element.shadowRoot) matches.push(...queryAllDeep(selector, element.shadowRoot));
  }
  return matches;
}

function pageText() {
  const parts = [document.body?.innerText || ""];
  for (const element of document.querySelectorAll("*")) {
    if (element.shadowRoot) parts.push(element.shadowRoot.textContent || "");
  }
  return parts.join("\n");
}

function findPromptBox() {
  const candidates = queryAllDeep('textarea, input[type="text"], [contenteditable="true"], [role="textbox"]')
    .filter((el) => el.getClientRects().length && !el.closest('[aria-hidden="true"]'));
  return candidates.sort((a, b) => {
    const score = (el) => {
      const hint = `${el.getAttribute("placeholder") || ""} ${el.getAttribute("aria-label") || ""}`.toLowerCase();
      return (el.matches("textarea") ? 3 : 0) + (/prompt|describe|ask/.test(hint) ? 5 : 0) + Math.min((el.getBoundingClientRect().width || 0) / 400, 2);
    };
    return score(b) - score(a);
  })[0] || null;
}

function setPromptValue(box, value) {
  box.focus();
  if (box instanceof HTMLTextAreaElement || box instanceof HTMLInputElement) {
    const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(box), "value")?.set;
    setter?.call(box, value);
    box.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: value }));
    box.dispatchEvent(new Event("change", { bubbles: true }));
  } else {
    box.textContent = value;
    box.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: value }));
  }
}

function visibleButtons() {
  return queryAllDeep('button, [role="button"], [role="menuitem"], [data-testid*="generate" i], [data-testid*="create" i], [data-testid*="send" i]')
    .filter((el) => el.getClientRects().length && !el.hasAttribute("disabled") && el.getAttribute("aria-disabled") !== "true");
}

let preferredExtendTarget = null;

function controlText(element) {
  const ownLabels = [
    textOf(element),
    element?.getAttribute?.("aria-label"),
    element?.getAttribute?.("aria-description"),
    element?.getAttribute?.("title"),
    element?.getAttribute?.("data-tooltip"),
    element?.getAttribute?.("data-testid")
  ];
  const childLabels = [...(element?.querySelectorAll?.("[aria-label], [title], [data-tooltip]") || [])]
    .flatMap((child) => [child.getAttribute("aria-label"), child.getAttribute("title"), child.getAttribute("data-tooltip")]);
  return [...ownLabels, ...childLabels].filter(Boolean).join(" ");
}

function findAction(pattern) {
  return visibleButtons().reverse().find((el) => pattern.test(controlText(el)));
}

function findComposerAction(box, pattern) {
  const excluded = /extend|download|upload|ingredients?|settings|more options|feedback|tùy chọn|tải xuống|tải ảnh/i;
  let node = box;
  for (let depth = 0; node && depth < 9; depth++, node = node.parentElement || node.getRootNode()?.host) {
    const candidates = queryAllDeep('button, [role="button"], [role="menuitem"]', node)
      .filter((element) => element.getClientRects().length && !element.hasAttribute("disabled") && element.getAttribute("aria-disabled") !== "true")
      .filter((element) => pattern.test(controlText(element)) && !excluded.test(controlText(element)));
    if (candidates.length) {
      return candidates.sort((a, b) => distanceToComposer(a, box) - distanceToComposer(b, box))[0];
    }
  }

  // Flow sometimes portals the composer action outside the editor subtree.
  const globalCandidates = visibleButtons()
    .filter((element) => pattern.test(controlText(element)) && !excluded.test(controlText(element)))
    .map((element) => ({ element, distance: distanceToComposer(element, box) }))
    .filter(({ element, distance }) => distance <= (/^(create|run|send|submit|start)$/i.test(controlText(element).trim()) ? 250 : 700))
    .sort((a, b) => a.distance - b.distance);
  if (globalCandidates.length) return globalCandidates[0].element;

  // Some Flow builds expose the submit control as an unlabeled arrow icon.
  // Only accept a unique icon button in the composer's lower-right action area.
  const boxRect = box.getBoundingClientRect();
  const iconCandidates = visibleButtons().filter((element) => {
    if (controlText(element).trim()) return false;
    if (!element.querySelector("svg, [data-icon], [class*=icon]")) return false;
    const rect = element.getBoundingClientRect();
    const nearComposerRight = rect.left >= boxRect.left + boxRect.width * 0.55 && rect.left <= boxRect.right + 140;
    const nearComposerBottom = rect.top >= boxRect.top + boxRect.height * 0.35 && rect.top <= boxRect.bottom + 150;
    return nearComposerRight && nearComposerBottom && rect.width >= 20 && rect.width <= 96 && rect.height >= 20 && rect.height <= 96;
  });
  return iconCandidates.length === 1 ? iconCandidates[0] : null;
}

function distanceToComposer(element, box) {
  const a = element.getBoundingClientRect();
  const b = box.getBoundingClientRect();
  const dx = Math.max(b.left - a.right, a.left - b.right, 0);
  const dy = Math.max(b.top - a.bottom, a.top - b.bottom, 0);
  return Math.hypot(dx, dy);
}

function nearbyControlsDescription(box) {
  if (!box) return "";
  return visibleButtons()
    .map((element) => ({ label: controlText(element).trim() || "(nút biểu tượng)", distance: distanceToComposer(element, box) }))
    .filter(({ distance }) => distance <= 700)
    .sort((a, b) => a.distance - b.distance)
    .slice(0, 8)
    .map(({ label, distance }) => `${label} ~${Math.round(distance)}px`)
    .join("; ");
}

function actionText(element) {
  return controlText(element).trim();
}

function pageSignals() {
  const body = pageText();
  const lowCredits = /not enough credits|out of credits|insufficient credits|không đủ (?:credit|credits)|hết (?:credit|credits)/i.test(body);
  const policy = /violat(?:es|ed) (?:our|the) (?:policy|policies)|can't generate|cannot generate|not allowed|doesn't comply|policy violation/i.test(body);
  const running = /generating|creating video|working on it|đang tạo/i.test(body);
  const failure = /generation failed|something went wrong|couldn't generate|try again/i.test(body);
  return { lowCredits, policy, running, failure };
}

function report(type, data = {}) {
  chrome.runtime.sendMessage({ type, ...data }).catch(() => {});
}

async function waitFor(predicate, timeout = 45000, interval = 500) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    const result = predicate();
    if (result) return result;
    await new Promise((resolve) => setTimeout(resolve, interval));
  }
  return null;
}

async function attachReferenceImages(images = []) {
  if (!images.length) return;

  const transfer = new DataTransfer();
  for (const image of images) {
    const blob = await fetch(image.data).then((response) => response.blob());
    transfer.items.add(new File([blob], image.name || "character-reference.jpg", { type: blob.type || "image/jpeg" }));
  }

  const findImageInput = () => queryAllDeep('input[type="file"]')
    .sort((a, b) => {
      const score = (el) => {
        const accept = (el.accept || "").toLowerCase();
        return (/image|\.png|\.jpe?g|\.webp|\*/.test(accept) ? 10 : 0) + (el.multiple ? 2 : 0);
      };
      return score(b) - score(a);
    })[0] || null;

  let input = findImageInput();
  if (!input) {
    const addIngredients = findAction(/add ingredients(?: to the prompt box)?|add media|thêm (?:nguyên liệu|tài nguyên|ảnh)/i);
    addIngredients?.click();
    input = await waitFor(findImageInput, 3000, 200);
  }

  if (!input) {
    const uploadMedia = findAction(/^(upload media|upload image|upload|tải (?:ảnh|lên))$/i);
    uploadMedia?.click();
    input = await waitFor(findImageInput, 4000, 200);
  }

  if (input) {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "files")?.set;
    if (setter) setter.call(input, transfer.files);
    else input.files = transfer.files;
    input.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
    input.dispatchEvent(new Event("change", { bubbles: true, composed: true }));
  } else {
    const prompt = findPromptBox();
    const dropTarget = prompt?.parentElement || prompt || document.body;
    for (const type of ["dragenter", "dragover", "drop"]) {
      dropTarget.dispatchEvent(new DragEvent(type, {
        bubbles: true,
        composed: true,
        cancelable: true,
        dataTransfer: transfer
      }));
    }
  }

  const attached = await waitFor(() => {
    if (input?.files?.length) return true;
    const text = pageText().toLowerCase();
    return [...transfer.files].some((file) => text.includes(file.name.toLowerCase()));
  }, 8000, 300);
  if (!attached) {
    throw new Error("Flow đã mở bộ tải ảnh nhưng không xác nhận được ảnh tham chiếu. Cảnh chưa được gửi.");
  }

  await new Promise((resolve) => setTimeout(resolve, 1800));
  const closeDialog = findAction(/^(close|done|đóng|xong)$/i);
  closeDialog?.click();
}

function videoSignature(video) {
  return [
    video.currentSrc,
    video.getAttribute("src"),
    video.getAttribute("poster"),
    video.getAttribute("data-testid"),
    video.getAttribute("aria-label")
  ].filter(Boolean).join("|");
}

function snapshotVideos() {
  return new Map(queryAllDeep("video").map((video) => [video, videoSignature(video)]));
}

function videosChangedSince(snapshot) {
  return queryAllDeep("video")
    .filter((video) => video.getClientRects().length)
    .filter((video) => !snapshot.has(video) || snapshot.get(video) !== videoSignature(video));
}

function rememberCompletedVideo(video) {
  if (video) preferredExtendTarget = { element: video, signature: videoSignature(video) };
}

async function waitForGeneration(scene, beforeVideos) {
  let settledTicks = 0;
  let completedVideo = null;
  const outcome = await waitFor(() => {
    const current = pageSignals();
    if (current.lowCredits) return { kind: "credits" };
    if (current.policy) return { kind: "policy" };
    if (current.failure) return { kind: "failure" };
    const changedVideos = videosChangedSince(beforeVideos);
    const resultReady = changedVideos.length > 0;
    if (resultReady) completedVideo = changedVideos.at(-1);
    settledTicks = !current.running && resultReady ? settledTicks + 1 : 0;
    if (settledTicks >= 3) return { kind: "complete" };
    return null;
  }, 12 * 60 * 1000, 2000);

  if (!outcome) throw Object.assign(new Error("Chưa xác nhận được Flow hoàn tất sau 12 phút. Workflow đã dừng để tránh tạo trùng."), { code: "TIMEOUT" });
  if (outcome.kind === "credits") throw Object.assign(new Error("Flow báo hết hoặc không đủ credits."), { code: "NO_CREDITS" });
  if (outcome.kind === "policy") throw Object.assign(new Error("Flow từ chối nội dung theo chính sách."), { code: "POLICY" });
  if (outcome.kind === "failure") throw Object.assign(new Error("Flow báo tạo video thất bại. Cần kiểm tra trước khi thử lại."), { code: "GENERATION_FAILED" });

  rememberCompletedVideo(completedVideo);
  report("FLOW_STATUS", { status: "scene-done", sceneId: scene.id, message: "Flow có dấu hiệu đã hoàn tất cảnh." });
}

async function ensureExtendCompatibleModel() {
  const agent = visibleButtons().find((button) => /^agent$/i.test(actionText(button)));
  const agentEnabled = agent && (
    agent.getAttribute("aria-pressed") === "true" ||
    agent.getAttribute("aria-checked") === "true" ||
    /on|active|selected/i.test(`${agent.getAttribute("data-state") || ""} ${agent.className || ""}`)
  );
  if (agentEnabled) {
    agent.click();
    await new Promise((resolve) => setTimeout(resolve, 700));
  }

  const settings = findAction(/settings trigger|generation settings|^settings$|^cài đặt$/i);
  settings?.click();
  await new Promise((resolve) => setTimeout(resolve, 600));

  let lite = findAction(/veo\s*3(?:\.1)?\s*(?:-|–)?\s*lite/i);
  if (!lite) {
    const modelControl = visibleButtons().find((button) =>
      /model|veo\s*3|gemini omni|omni flash/i.test(actionText(button)) &&
      !/settings/i.test(actionText(button))
    );
    modelControl?.click();
    lite = await waitFor(() => findAction(/veo\s*3(?:\.1)?\s*(?:-|–)?\s*lite/i), 5000, 250);
  }

  if (!lite) {
    throw Object.assign(new Error("Không thể chọn Veo 3.1 Lite trong Generation settings. Extend chỉ khả dụng với video Veo tương thích; hãy chọn thủ công Video → Veo 3.1 Lite rồi tạo lại cảnh 1."), { code: "EXTEND_MODEL_REQUIRED" });
  }

  lite.click();
  await new Promise((resolve) => setTimeout(resolve, 800));
  return true;
}

function findExtendAction() {
  return findAction(/\bextend\b|continue (?:this )?(?:video|clip)|nối dài|mở rộng/i);
}

function latestVisibleVideo() {
  return queryAllDeep("video")
    .filter((video) => video.getClientRects().length)
    .sort((a, b) => {
      const ar = a.getBoundingClientRect();
      const br = b.getBoundingClientRect();
      return (ar.top + ar.left) - (br.top + br.left);
    })
    .at(-1) || null;
}

function resolvePreferredVideo() {
  if (!preferredExtendTarget) return null;
  const { element, signature } = preferredExtendTarget;
  if (element?.isConnected && element.getClientRects().length) {
    preferredExtendTarget.signature = videoSignature(element);
    return element;
  }
  const match = queryAllDeep("video").find((video) => video.getClientRects().length && videoSignature(video) === signature);
  if (match) {
    preferredExtendTarget.element = match;
    return match;
  }
  return null;
}

function buttonsInVideoAncestors(video) {
  if (!video) return { buttons: [], extend: null };
  const buttons = [];
  let node = video;
  for (let depth = 0; node && depth < 9; depth++, node = node.parentElement || node.getRootNode()?.host) {
    buttons.push(...queryAllDeep('button, [role="button"], [role="menuitem"]', node)
      .filter((button) => button !== video && button.getClientRects().length));
    const extend = buttons.find((button) => /\bextend\b|continue (?:this )?(?:video|clip)|nối dài|mở rộng/i.test(controlText(button)));
    if (extend) return { buttons, extend };
  }
  return { buttons, extend: null };
}

function findExtendForVideo(video) {
  return buttonsInVideoAncestors(video).extend;
}

function activateMedia(video) {
  if (!video) return;
  const target = video.closest('button, [role="button"], [tabindex], article') || video;
  target.scrollIntoView({ block: "center", inline: "center" });
  for (const type of ["pointerover", "mouseover", "mouseenter"]) {
    target.dispatchEvent(new MouseEvent(type, { bubbles: true, composed: true }));
  }
  target.click();
}

function nearestMoreMenu(video) {
  const candidates = visibleButtons().filter((button) =>
    /more (?:options|actions)|overflow|kebab|menu|thêm tùy chọn|tùy chọn khác/i.test(
      `${textOf(button)} ${button.getAttribute("aria-label") || ""} ${button.getAttribute("data-tooltip") || ""}`
    )
  );
  if (!candidates.length || !video) return candidates.at(-1) || null;
  const rect = video.getBoundingClientRect();
  const center = [rect.left + rect.width / 2, rect.top + rect.height / 2];
  return candidates.sort((a, b) => {
    const distance = (element) => {
      const r = element.getBoundingClientRect();
      return Math.hypot(r.left + r.width / 2 - center[0], r.top + r.height / 2 - center[1]);
    };
    return distance(a) - distance(b);
  })[0];
}

async function openExtendForLatestVideo() {
  const video = resolvePreferredVideo() || latestVisibleVideo();
  if (!video) return null;

  let extend = findExtendForVideo(video);
  if (extend) return extend;

  activateMedia(video);
  extend = await waitFor(() => findExtendForVideo(video), 6000, 300);
  if (extend) return extend;

  const controls = buttonsInVideoAncestors(video).buttons;
  const more = nearestMoreMenu(video) || controls.filter((button) =>
    /more (?:options|actions)|overflow|kebab|menu|thêm tùy chọn|tùy chọn khác/i.test(controlText(button))
  ).at(0);
  if (more) {
    more.click();
    // Flow may render its menu in a portal outside the video card.
    extend = await waitFor(findExtendAction, 7000, 300);
    if (extend) return extend;
  }

  return null;
}

async function submitScene(scene) {
  const box = await waitFor(findPromptBox, 15000);
  if (!box) throw new Error("Không tìm thấy ô prompt trên Flow.");
  await ensureExtendCompatibleModel();
  const beforeVideos = snapshotVideos();
  setPromptValue(box, scene.prompt);
  await new Promise((resolve) => setTimeout(resolve, 600));
  await attachReferenceImages(scene.characterImages || []);

  const signals = pageSignals();
  if (signals.lowCredits) throw Object.assign(new Error("Flow báo không đủ credits."), { code: "NO_CREDITS" });
  if (signals.policy) throw Object.assign(new Error("Flow từ chối nội dung theo chính sách."), { code: "POLICY" });

  const currentBox = await waitFor(findPromptBox, 5000, 250);
  const generate = currentBox && await waitFor(
    () => findComposerAction(currentBox, /\b(generate|create|make video|submit|send|run)\b|arrow.?forward|arrow.?up|north.?east|tạo(?: video| hình ảnh)?|bắt đầu tạo|tạo video/i),
    10000,
    300
  );
  if (!generate) {
    const nearby = nearbyControlsDescription(currentBox);
    throw new Error(`Đã điền prompt nhưng chưa xác định được nút gửi an toàn; extension chưa gửi tác vụ.${nearby ? ` Các nút gần ô prompt: ${nearby}` : " Không thấy nút khả dụng gần ô prompt."}`);
  }
  generate.click();
  report("FLOW_STATUS", { status: "generating", sceneId: scene.id, message: "Đã gửi cảnh đến Flow." });

  await waitForGeneration(scene, beforeVideos);
  return { ok: true };
}

async function extendScene(scene) {
  let extend = await openExtendForLatestVideo();
  if (!extend) throw Object.assign(new Error("Không tìm thấy thao tác Extend trên video vừa hoàn tất. Hãy mở menu của đúng video trong Flow và kiểm tra thao tác Extend; extension đã dừng để tránh nối nhầm video."), { code: "EXTEND_ACTION_NOT_FOUND" });
  extend.click();
  const box = await waitFor(findPromptBox, 10000);
  if (!box) throw new Error("Đã mở Extend nhưng không tìm thấy ô prompt.");
  const beforeVideos = snapshotVideos();
  setPromptValue(box, scene.prompt);
  await attachReferenceImages(scene.characterImages || []);
  await new Promise((resolve) => setTimeout(resolve, 500));
  const currentBox = await waitFor(findPromptBox, 5000, 250);
  const generate = currentBox && await waitFor(
    () => findComposerAction(currentBox, /\b(generate|create|make video|submit|send|run)\b|arrow.?forward|arrow.?up|north.?east|tạo(?: video| hình ảnh)?|bắt đầu tạo|tạo video/i),
    10000,
    300
  );
  if (!generate) {
    const nearby = nearbyControlsDescription(currentBox);
    throw new Error(`Đã chuẩn bị prompt Extend nhưng chưa xác định được nút gửi an toàn; extension chưa gửi tác vụ.${nearby ? ` Các nút gần ô prompt: ${nearby}` : " Không thấy nút khả dụng gần ô prompt."}`);
  }
  generate.click();
  report("FLOW_STATUS", { status: "generating", sceneId: scene.id, message: "Đã gửi phần Extend đến Flow." });
  await waitForGeneration(scene, beforeVideos);
  return { ok: true };
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!message || !["FILL_PROMPT", "GENERATE_SCENE", "EXTEND_SCENE", "CHECK_FLOW"].includes(message.type)) return;

  if (message.type === "CHECK_FLOW") {
    sendResponse({ ok: true, connected: !!findPromptBox(), signals: pageSignals() });
    return;
  }

  if (message.type === "FILL_PROMPT") {
    const box = findPromptBox();
    if (!box) {
      sendResponse({ ok: false, error: "Không tìm thấy ô prompt trên Flow." });
      return;
    }
    setPromptValue(box, message.scene.prompt);
    sendResponse({ ok: true });
    return;
  }

  // Return immediately for generation commands. Flow can take many minutes
  // to render a clip, longer than Chrome keeps an extension message channel.
  sendResponse({ ok: true, accepted: true, sceneId: message.scene?.id });
  (async () => {
    if (message.type === "GENERATE_SCENE") await submitScene(message.scene);
    else await extendScene(message.scene);
  })().catch((error) => {
    report("FLOW_ERROR", { sceneId: message.scene?.id, code: error.code || "UI_UNRECOGNIZED", message: error.message });
  });
});
