const DEFAULT_PROJECT = {
  title: "",
  aspectRatio: "9:16",
  transitionMode: "extend",
  running: false,
  status: "idle",
  statusMessage: "Sẵn sàng · tiến trình được lưu tự động",
  characters: [],
  scenes: []
};

let project = structuredClone(DEFAULT_PROJECT);
let loopActive = false;
let saveTimer;
let toastTimer;
const sceneResultWaiters = new Map();
const $ = (selector) => document.querySelector(selector);

function persist() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => chrome.storage.local.set({ flowSceneDirectorProject: project }), 150);
}

function toast(message) {
  const el = $("#toast");
  el.textContent = message;
  el.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove("show"), 2600);
}

function statusLabel(status) {
  return ({ pending: "Chờ", generating: "Đang tạo", done: "Hoàn tất", error: "Lỗi", skipped: "Bỏ qua" })[status] || "Chờ";
}

function sceneDurationLabel(scene) {
  const value = String(scene.duration || "").trim();
  if (!value) return "Thời lượng theo prompt";
  return /^\d+(?:\.\d+)?$/.test(value) ? `${value} giây` : value;
}

function sceneDurationPrompt(scene) {
  const value = String(scene.duration || "").trim();
  if (!value) return "";
  if (/^\d+(?:\.\d+)?$/.test(value)) return `${value}-second`;
  const seconds = value.match(/^(\d+(?:\.\d+)?)\s*(?:s|sec|secs|second|seconds|giây)$/i);
  return seconds ? `${seconds[1]}-second` : value;
}

function projectDurationLabel() {
  const seconds = project.scenes.map((scene) => {
    const match = String(scene.duration || "").match(/(\d+(?:\.\d+)?)/);
    return match ? Number(match[1]) : NaN;
  });
  if (!seconds.length || seconds.some((value) => !Number.isFinite(value))) return "thời lượng theo CSV";
  const total = seconds.reduce((sum, value) => sum + value, 0);
  return `khoảng ${Number.isInteger(total) ? total : total.toFixed(1)} giây`;
}

function render() {
  $("#projectTitle").value = project.title;
  $("#aspectRatio").value = project.aspectRatio;
  $("#transitionMode").value = project.transitionMode;
  $("#runButton").disabled = loopActive || (project.status === "paused-no-credits" && project.running);
  $("#runButton").querySelector("span:last-child").textContent = project.status === "paused" || project.status === "paused-no-credits" ? "Tiếp tục tự chạy" : loopActive ? "Đang chạy…" : "Bắt đầu tự chạy";
  $("#pauseButton").disabled = !project.running;
  $("#statusBar").dataset.state = project.status === "paused-no-credits" || project.status === "paused-policy" ? "error" : project.status;
  $("#statusText").textContent = project.statusMessage;
  const totalScenes = project.scenes.length;
  $("#sceneCount").textContent = `${project.scenes.filter((scene) => scene.status === "done").length} / ${totalScenes} hoàn tất`;
  $("#projectSummary").textContent = totalScenes ? `${totalScenes} cảnh · ${projectDurationLabel()}` : "Nhập CSV để tạo danh sách cảnh";
  $("#workflowSummary").textContent = totalScenes ? "Mỗi cảnh cần ảnh Canva · cảnh sau tự kèm @last_keyframe · ảnh tham chiếu Veo 3.1 Lite cần 8s · có thể chuyển tab khi chạy" : "Nhập CSV có cột prompt; extension sẽ tự nhận diện số cảnh và @nhân vật";
  renderScenes();
  renderCharacters();
}

function renderScenes() {
  const list = $("#sceneList");
  list.replaceChildren();
  if (!project.scenes.length) {
    const empty = document.createElement("div");
    empty.className = "empty-state";
    empty.textContent = "Chưa có phân cảnh. Hãy nhập file CSV để tạo danh sách tự động.";
    list.append(empty);
    return;
  }
  project.scenes.forEach((scene, index) => {
    const card = document.createElement("article");
    card.className = "scene-card";
    const head = document.createElement("div");
    head.className = "scene-head";
    const transition = scene.transition || (index === 0 ? "Mở đầu" : "Nối tiếp bằng Extend");
    head.innerHTML = `<span class="scene-number">${index + 1}</span><div class="scene-info"><div class="scene-title">${escapeHtml(scene.title || `Phân cảnh ${index + 1}`)}</div><div class="scene-subtitle">${escapeHtml(sceneDurationLabel(scene))} · ${escapeHtml(transition)}</div></div><span class="scene-state" data-state="${scene.status}">${statusLabel(scene.status)}</span>`;
    const prompt = document.createElement("textarea");
    prompt.className = "scene-prompt";
    prompt.placeholder = `Mô tả hành động, bối cảnh, góc máy và âm thanh cho cảnh ${index + 1}…`;
    prompt.value = scene.prompt;
    prompt.dataset.scenePrompt = scene.id;
    const referenceRow = document.createElement("div");
    referenceRow.className = "scene-reference-row";
    const compositeLabel = document.createElement("label");
    compositeLabel.className = "scene-reference-label";
    compositeLabel.textContent = scene.compositeImage ? `Đổi ảnh Canva · ${scene.compositeImage.name}` : "Nhập ảnh Canva / ảnh tổng hợp";
    const compositeInput = document.createElement("input");
    compositeInput.type = "file";
    compositeInput.accept = "image/*";
    compositeInput.hidden = true;
    compositeInput.dataset.sceneCanva = scene.id;
    compositeLabel.append(compositeInput);
    referenceRow.append(compositeLabel);
    if (scene.compositeImage?.data) {
      const preview = document.createElement("img");
      preview.className = "scene-reference-thumb";
      preview.src = scene.compositeImage.data;
      preview.alt = `Ảnh Canva cảnh ${index + 1}`;
      referenceRow.append(preview);
    }
    if (index > 0) {
      const previousKeyframe = project.scenes[index - 1]?.keyframe;
      const keyframeInfo = document.createElement("span");
      keyframeInfo.className = `scene-keyframe-info${previousKeyframe?.data ? " is-ready" : ""}`;
      keyframeInfo.textContent = previousKeyframe?.data ? "@last_keyframe đã sẵn sàng" : "Cần @last_keyframe từ cảnh trước";
      referenceRow.append(keyframeInfo);
      if (previousKeyframe?.data) {
        const keyframeThumb = document.createElement("img");
        keyframeThumb.className = "scene-reference-thumb keyframe-thumb";
        keyframeThumb.src = previousKeyframe.data;
        keyframeThumb.alt = "@last_keyframe từ cảnh trước";
        referenceRow.append(keyframeThumb);
      }
    }
    if (scene.keyframe?.data) {
      const savedLabel = document.createElement("span");
      savedLabel.className = "scene-keyframe-info is-ready";
      savedLabel.textContent = "Keyframe cuối đã lưu · @last_keyframe";
      referenceRow.append(savedLabel);
    }
    const actions = document.createElement("div");
    actions.className = "scene-actions";
    const charSelect = document.createElement("select");
    charSelect.className = "scene-characters";
    charSelect.multiple = true;
    charSelect.size = 1;
    charSelect.title = "Chọn nhân vật: giữ Command hoặc Control để chọn nhiều";
    project.characters.forEach((character) => {
      const option = document.createElement("option");
      option.value = character.id;
      option.textContent = character.name || "Nhân vật mới";
      option.selected = scene.characterIds.includes(character.id);
      charSelect.append(option);
    });
    if (!project.characters.length) {
      const option = document.createElement("option");
      option.textContent = "Thêm nhân vật bên dưới";
      option.disabled = true;
      charSelect.append(option);
    }
    charSelect.dataset.sceneCharacters = scene.id;
    const fill = document.createElement("button");
    fill.className = "small-action";
    fill.textContent = "Điền";
    fill.title = "Chỉ điền prompt, không tạo video";
    fill.dataset.fillScene = scene.id;
    actions.append(charSelect, fill);
    card.append(head, prompt, referenceRow, actions);
    list.append(card);
  });
}

function renderCharacters() {
  const list = $("#characterList");
  list.replaceChildren();
  $("#characterCount").textContent = `${project.characters.length} nhân vật · ảnh lưu trong Chrome`;
  if (!project.characters.length) {
    const empty = document.createElement("div");
    empty.className = "empty-state";
    empty.textContent = "Thêm nhân vật anime và ảnh tham chiếu để gán vào từng cảnh.";
    list.append(empty);
    return;
  }
  project.characters.forEach((character) => {
    const card = document.createElement("article");
    card.className = "character-card";
    const thumb = character.images?.[0]?.data ? `<img class="character-thumb" src="${character.images[0].data}" alt="">` : `<div class="character-thumb"></div>`;
    card.innerHTML = `<div class="character-top">${thumb}<input class="character-field character-name-input" data-character-name="${character.id}" value="${escapeHtml(character.name || "")}" placeholder="Tên nhân vật" maxlength="60"><button class="character-remove" data-remove-character="${character.id}" title="Xóa nhân vật" aria-label="Xóa nhân vật">×</button></div>`;
    const description = document.createElement("textarea");
    description.className = "character-field character-desc-input";
    description.dataset.characterDescription = character.id;
    description.placeholder = "Ngoại hình, trang phục, màu sắc, phụ kiện cần giữ nhất quán";
    description.rows = 2;
    description.value = character.description || "";
    card.append(description);
    if (character.images?.length > 1) {
      const images = document.createElement("div");
      images.className = "character-images";
      character.images.slice(1).forEach((item) => {
        const image = document.createElement("img");
        image.src = item.data;
        image.alt = item.name || "Ảnh tham chiếu";
        images.append(image);
      });
      card.append(images);
    }
    const actions = document.createElement("div");
    actions.className = "character-card-actions";
    const uploadLabel = document.createElement("label");
    uploadLabel.className = "file-label";
    uploadLabel.textContent = "Thêm turnaround / ảnh";
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/*";
    input.multiple = true;
    input.dataset.characterImages = character.id;
    uploadLabel.append(input);
    actions.append(uploadLabel);
    card.append(actions);
    list.append(card);
  });
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
}

function fullPrompt(scene, sceneIndex = project.scenes.findIndex((entry) => entry.id === scene.id)) {
  const assigned = project.characters.filter((character) => scene.characterIds.includes(character.id));
  const refs = assigned.map((character) => {
    const mention = character.name ? `@${character.name.replace(/^@+/, "").replace(/\s+/g, "")}` : "nhân vật";
    const details = [mention, character.description].filter(Boolean).join(": ");
    return details;
  });
  const continuity = assigned.length ? `\n\nCharacter consistency: ${refs.join("; ")}. Keep each character's face, hairstyle, clothing, colors, proportions, and signature props consistent. Do not swap features or outfits between characters.` : "";
  const canvaReference = scene.compositeImage?.data ? `\n\nUse @scene_${sceneIndex + 1}_canva as this scene's unique Canva composition/reference image. Follow its layout and intended visual relationships while animating the scene.` : "";
  const lastKeyframe = sceneIndex > 0 ? "\n\nMandatory visual continuity reference: @last_keyframe is the automatically saved final frame of the immediately preceding scene. Use it as the exact opening visual anchor; preserve subject identity and placement, camera angle, lighting, and environment. Treat @last_keyframe as an image reference, not a character." : "";
  const declaredReferences = (scene.referenceImages || []).filter((name) => name.toLowerCase() !== "last_keyframe");
  const references = declaredReferences.length ? `\n\nUse these additional imported visual references: ${declaredReferences.map((name) => `@${name.replace(/^@+/, "")}`).join(", ")}.` : "";
  const duration = sceneDurationPrompt(scene);
  return `${scene.prompt.trim()}${continuity}${canvaReference}${lastKeyframe}${references}\n\nFormat: ${project.aspectRatio}.${duration ? ` ${duration}` : ""} cinematic anime scene. Preserve the existing audio direction.`;
}

async function flowCommand(command) {
  return chrome.runtime.sendMessage({ type: "FLOW_COMMAND", command });
}

function waitForSceneResult(sceneId, timeoutMs = 13 * 60 * 1000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      sceneResultWaiters.delete(sceneId);
      reject(Object.assign(new Error("Flow chưa gửi tín hiệu hoàn tất sau 13 phút. Workflow đã dừng để tránh tạo trùng."), { code: "TIMEOUT" }));
    }, timeoutMs);
    sceneResultWaiters.set(sceneId, {
      resolve(value) { clearTimeout(timer); sceneResultWaiters.delete(sceneId); resolve(value); },
      reject(error) { clearTimeout(timer); sceneResultWaiters.delete(sceneId); reject(error); },
      cancel() { clearTimeout(timer); sceneResultWaiters.delete(sceneId); }
    });
  });
}

function cancelSceneResultWait(sceneId) {
  const waiter = sceneResultWaiters.get(sceneId);
  if (!waiter) return;
  waiter.cancel();
}

async function runSceneCommand(scene, method, characterImages, sceneIndex) {
  const completion = waitForSceneResult(scene.id);
  try {
    const result = await flowCommand({ type: method, scene: { id: scene.id, prompt: fullPrompt(scene, sceneIndex), characterImages } });
    if (!result?.ok) {
      const err = new Error(result?.error || "Flow không nhận lệnh.");
      err.code = result?.code || "FLOW_ERROR";
      throw err;
    }
    if (result.accepted) await completion;
    else cancelSceneResultWait(scene.id);
  } catch (error) {
    cancelSceneResultWait(scene.id);
    throw error;
  }
}

function setProjectStatus(status, message) {
  project.status = status;
  project.statusMessage = message;
  persist();
  render();
}

async function checkFlow() {
  const result = await flowCommand({ type: "CHECK_FLOW" });
  if (!result?.ok) {
    $("#flowConnection").dataset.connected = "false";
    toast(result?.error || "Không thể kết nối với tab Flow.");
    return false;
  }
  $("#flowConnection").dataset.connected = String(result.connected);
  $("#flowConnection").lastChild.textContent = result.connected ? "Flow đã kết nối" : "Chưa thấy ô prompt Flow";
  if (result.signals?.lowCredits) {
    setProjectStatus("paused-no-credits", "Flow đang báo không đủ credits. Tiến trình đã lưu.");
    return false;
  }
  return result.connected;
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForCredits() {
  setProjectStatus("paused-no-credits", "Hết credits · đang chờ Flow sẵn sàng trở lại…");
  let elapsed = 0;
  while (project.running) {
    await delay(250);
    if (!project.running) break;
    elapsed += 250;
    if (elapsed < 60000) continue;
    elapsed = 0;
    const result = await flowCommand({ type: "CHECK_FLOW" }).catch(() => null);
    if (result?.ok && !result.signals?.lowCredits) {
      toast("Flow không còn báo hết credits. Tiếp tục từ cảnh đang dở.");
      return true;
    }
  }
  return false;
}

async function runScenes() {
  if (loopActive) return;
  loopActive = true;
  project.running = true;
  project.status = "running";
  project.statusMessage = "Đang kiểm tra Flow…";
  persist();
  render();
  try {
    if (!project.scenes.length) throw Object.assign(new Error("Chưa có phân cảnh. Hãy nhập file CSV trước khi chạy."), { code: "NO_SCENES" });
    const connected = await checkFlow();
    if (!connected) {
      if (project.status === "paused-no-credits") throw Object.assign(new Error("Flow chưa đủ credits."), { code: "NO_CREDITS" });
      throw new Error("Mở Google Flow trong tab đang chọn rồi thử lại.");
    }
    for (let index = 0; index < project.scenes.length && project.running; index++) {
      const scene = project.scenes[index];
      if (scene.status === "done" || scene.status === "skipped") continue;
      if (!scene.prompt.trim()) throw Object.assign(new Error(`Cảnh ${index + 1} chưa có prompt.`), { code: "MISSING_PROMPT" });
      if (!scene.compositeImage?.data) throw Object.assign(new Error(`Cảnh ${index + 1} chưa có ảnh Canva/ảnh tổng hợp. Hãy nhập ảnh cho từng cảnh trước khi chạy.`), { code: "SCENE_IMAGE_REQUIRED" });
      if (index > 0 && !project.scenes[index - 1]?.keyframe?.data) throw Object.assign(new Error(`Cảnh ${index + 1} chưa có @last_keyframe từ cảnh ${index}. Hãy hoàn tất cảnh trước và lưu keyframe trước khi tiếp tục.`), { code: "KEYFRAME_REQUIRED" });
      const durationMatch = String(scene.duration || "").match(/^(\d+(?:\.\d+)?)\s*(?:s|sec|secs|second|seconds|giây)?$/i);
      if (durationMatch && Number(durationMatch[1]) !== 8) throw Object.assign(new Error(`Cảnh ${index + 1} có ảnh Canva/keyframe nhưng đặt ${durationMatch[1]}s. Veo 3.1 Lite chỉ hỗ trợ Ingredients/References ở clip 8 giây; hãy đổi cảnh này thành 8s trước khi chạy.`), { code: "REFERENCE_DURATION_UNSUPPORTED" });
      const isFirst = index === 0;
      const transition = String(scene.transition || project.transitionMode || "extend").trim().toLowerCase();
      const method = isFirst || transition === "independent" || transition === "jump to" ? "GENERATE_SCENE" : "EXTEND_SCENE";
      scene.status = "generating";
      project.statusMessage = `${isFirst ? "Đang tạo" : method === "EXTEND_SCENE" ? "Đang Extend" : "Đang tạo từ ảnh tham chiếu + keyframe"} cảnh ${index + 1}/${project.scenes.length}…`;
      persist();
      render();
      const characterImages = [
        { ...scene.compositeImage, name: `@scene_${index + 1}_canva.jpg` },
        ...(index > 0 ? [{ ...project.scenes[index - 1].keyframe, name: "@last_keyframe.jpg" }] : []),
        ...project.characters
        .filter((character) => scene.characterIds.includes(character.id))
        .flatMap((character) => (character.images || []).slice(0, 2))
      ];
      await runSceneCommand(scene, method, characterImages, index);
      scene.status = "done";
      scene.note = "Đã nhận diện tín hiệu hoàn tất từ Flow.";
      project.statusMessage = `Hoàn tất cảnh ${index + 1}/${project.scenes.length}.`;
      persist();
      render();
    }
    if (project.running && project.scenes.every((scene) => ["done", "skipped"].includes(scene.status))) {
      project.status = "done";
      project.statusMessage = `Đã xử lý xong ${project.scenes.length} cảnh. Kiểm tra Scenebuilder trong Flow.`;
      toast(`Hoàn tất ${project.scenes.length} cảnh. Thêm hoặc sắp xếp các clip trong Scenebuilder.`);
    } else if (project.running) {
      project.status = "paused";
      project.statusMessage = "Đã dừng. Bấm Tiếp tục để chạy cảnh còn lại.";
    }
  } catch (error) {
    const current = project.scenes.find((scene) => scene.status === "generating");
    if (current) current.status = ["NO_CREDITS", "CANCELLED"].includes(error.code) ? "pending" : "error";
    project.running = false;
    if (error.code === "CANCELLED") {
      project.status = "paused";
      project.statusMessage = "Đã dừng workflow. Cảnh đang chạy được giữ lại để tiếp tục sau.";
      toast("Đã dừng workflow.");
      return;
    }
    if (error.code === "NO_CREDITS") {
      project.running = true;
      project.status = "paused-no-credits";
      project.statusMessage = "Hết credits · đang lưu cảnh dở và kiểm tra lại mỗi phút.";
      toast("Flow hết credits. Đang tạm dừng và chờ.");
      persist();
      render();
      loopActive = false;
      const available = await waitForCredits();
      if (available) setTimeout(() => runScenes(), 0);
      return;
    }
    if (error.code === "POLICY") {
      project.status = "paused-policy";
      project.statusMessage = "Flow từ chối nội dung. Đã dừng tại cảnh này.";
    } else {
      project.status = "error";
      project.statusMessage = error.message || "Workflow đã dừng.";
    }
    toast(error.message || "Workflow đã dừng.");
  } finally {
    if (project.status !== "paused-no-credits") project.running = false;
    loopActive = false;
    persist();
    render();
  }
}

function parseCsv(text) {
  const rows = [];
  let row = [], field = "", quoted = false;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (quoted && char === '"' && text[i + 1] === '"') { field += '"'; i++; }
    else if (char === '"') quoted = !quoted;
    else if (char === "," && !quoted) { row.push(field); field = ""; }
    else if ((char === "\n" || char === "\r") && !quoted) {
      if (char === "\r" && text[i + 1] === "\n") i++;
      row.push(field); if (row.some((cell) => cell.trim())) rows.push(row);
      row = []; field = "";
    } else field += char;
  }
  row.push(field); if (row.some((cell) => cell.trim())) rows.push(row);
  if (!rows.length) return [];
  const headers = rows.shift().map((value) => value.replace(/^\uFEFF/, "").trim().toLowerCase());
  return rows.map((cells) => Object.fromEntries(headers.map((header, i) => [header, cells[i] || ""])));
}

function characterKey(name) {
  return String(name || "").replace(/^@+/, "").trim().normalize("NFC").toLocaleLowerCase();
}

function extractCharacterMentions(...values) {
  const mentions = [];
  const seen = new Set();
  const pattern = /@([\p{L}\p{N}_-]+)/gu;
  for (const value of values) {
    for (const match of String(value || "").matchAll(pattern)) {
      const name = match[1];
      const key = characterKey(name);
      if (key === "last_keyframe") continue;
      if (!key || seen.has(key)) continue;
      seen.add(key);
      mentions.push(name);
    }
  }
  return mentions;
}

function scenesFromCsv(rows) {
  const usableRows = rows.filter((row) => String(row.prompt || row.description || "").trim());
  if (!usableRows.length) throw new Error("CSV cần có ít nhất một dòng với cột prompt.");

  const charactersByKey = new Map(project.characters.map((character) => [characterKey(character.name), character]));
  const importedNames = new Set();
  const scenes = usableRows.map((row, index) => {
    const mentions = extractCharacterMentions(row.prompt, row.characters, row.title, row.dialogue, row.notes);
    const characterIds = mentions.map((name) => {
      const key = characterKey(name);
      let character = charactersByKey.get(key);
      if (!character) {
        character = { id: crypto.randomUUID(), name, description: "", images: [] };
        project.characters.push(character);
        charactersByKey.set(key, character);
        importedNames.add(name);
      }
      return character.id;
    });
    return {
      id: `scene-${index + 1}`,
      sceneNumber: row.scene_number || String(index + 1),
      duration: row.duration || "",
      title: row.title || row.scene || `Phân cảnh ${index + 1}`,
      prompt: row.prompt || row.description || "",
      status: "pending",
      characterIds,
      compositeImage: null,
      keyframe: null,
      referenceImages: String(row.reference_images || "").split(/[;,]/).map((name) => name.trim().replace(/^@+/, "")).filter(Boolean),
      characters: row.characters || mentions.map((name) => `@${name}`).join(", "),
      transition: row.transition || "",
      dialogue: row.dialogue || "",
      notes: row.notes || "",
      note: ""
    };
  });
  return { scenes, importedNames: [...importedNames] };
}

function normalizeImportedScenes(scenes = []) {
  return scenes.map((scene, index) => ({
    id: scene.id || `scene-${index + 1}`,
    sceneNumber: scene.sceneNumber || scene.scene_number || String(index + 1),
    duration: scene.duration || "",
    title: scene.title || `Phân cảnh ${index + 1}`,
    prompt: scene.prompt || "",
    status: scene.status || "pending",
    characterIds: Array.isArray(scene.characterIds) ? scene.characterIds : [],
    characters: scene.characters || "",
    transition: scene.transition || "",
    dialogue: scene.dialogue || "",
    notes: scene.notes || "",
    compositeImage: scene.compositeImage || null,
    keyframe: scene.keyframe || null,
    referenceImages: Array.isArray(scene.referenceImages) ? scene.referenceImages : String(scene.reference_images || "").split(/[;,]/).map((name) => name.trim().replace(/^@+/, "")).filter(Boolean),
    note: scene.note || ""
  }));
}

function downloadFile(name, contents, type) {
  const url = URL.createObjectURL(new Blob([contents], { type }));
  const anchor = document.createElement("a");
  anchor.href = url; anchor.download = name; anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function addImageFiles(characterId, files) {
  const character = project.characters.find((entry) => entry.id === characterId);
  if (!character) return;
  const selected = [...files].slice(0, Math.max(0, 10 - character.images.length));
  for (const file of selected) {
    if (!file.type.startsWith("image/")) continue;
    if (file.size > 5 * 1024 * 1024) { toast(`${file.name} vượt giới hạn 5 MB.`); continue; }
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, 1280 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * scale); canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext("2d").drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const data = canvas.toDataURL("image/jpeg", 0.84);
    bitmap.close();
    character.images.push({ id: crypto.randomUUID(), name: file.name, data });
  }
  persist(); renderCharacters();
}

async function addSceneComposite(sceneId, file) {
  const scene = project.scenes.find((entry) => entry.id === sceneId);
  if (!scene || !file) return;
  if (!file.type.startsWith("image/")) { toast("Ảnh Canva phải là tệp hình ảnh."); return; }
  if (file.size > 10 * 1024 * 1024) { toast("Ảnh tổng hợp vượt giới hạn 10 MB."); return; }
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext("2d").drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  const data = canvas.toDataURL("image/jpeg", 0.84);
  bitmap.close();
  scene.compositeImage = { name: file.name, data };
  persist();
  renderScenes();
  toast(`Đã nhập ảnh Canva cho cảnh ${Number(scene.sceneNumber) || project.scenes.indexOf(scene) + 1}.`);
}

$("#projectTitle").addEventListener("input", (event) => { project.title = event.target.value; persist(); });
$("#aspectRatio").addEventListener("change", (event) => { project.aspectRatio = event.target.value; persist(); renderScenes(); });
$("#transitionMode").addEventListener("change", (event) => { project.transitionMode = event.target.value; persist(); renderScenes(); });
$("#runButton").addEventListener("click", () => runScenes());
$("#pauseButton").addEventListener("click", () => {
  project.running = false;
  const scene = project.scenes.find((entry) => entry.status === "generating");
  if (scene) scene.status = "pending";
  project.status = "paused";
  project.statusMessage = "Đã dừng workflow. Đang hủy thao tác Flow hiện tại…";
  persist();
  render();
  if (scene) sceneResultWaiters.get(scene.id)?.reject(Object.assign(new Error("Đã dừng workflow theo yêu cầu."), { code: "CANCELLED" }));
  flowCommand({ type: "CANCEL_WORKFLOW" }).catch(() => {});
  toast("Đã dừng workflow.");
});
$("#checkFlow").addEventListener("click", async () => { const ok = await checkFlow(); if (ok) toast("Đã kết nối với trang Flow."); });
$("#sceneList").addEventListener("input", (event) => {
  const id = event.target.dataset.scenePrompt;
  if (!id) return;
  const scene = project.scenes.find((entry) => entry.id === id);
  if (scene) { scene.prompt = event.target.value; persist(); }
});
$("#sceneList").addEventListener("change", (event) => {
  const compositeSceneId = event.target.dataset.sceneCanva;
  if (compositeSceneId) {
    addSceneComposite(compositeSceneId, event.target.files?.[0]);
    event.target.value = "";
    return;
  }
  const id = event.target.dataset.sceneCharacters;
  if (!id) return;
  const scene = project.scenes.find((entry) => entry.id === id);
  if (scene) { scene.characterIds = [...event.target.selectedOptions].map((option) => option.value); persist(); }
});
$("#characterList").addEventListener("input", (event) => {
  const id = event.target.dataset.characterName || event.target.dataset.characterDescription;
  const character = project.characters.find((entry) => entry.id === id);
  if (!character) return;
  if (event.target.dataset.characterName) character.name = event.target.value;
  else character.description = event.target.value;
  persist();
});
$("#sceneList").addEventListener("click", async (event) => {
  const id = event.target.dataset.fillScene;
  if (!id) return;
  const scene = project.scenes.find((entry) => entry.id === id);
  if (!scene?.prompt.trim()) { toast("Hãy viết prompt cho cảnh này trước."); return; }
  const result = await flowCommand({ type: "FILL_PROMPT", scene: { id, prompt: fullPrompt(scene) } });
  toast(result?.ok ? "Đã điền prompt vào Flow." : result?.error || "Không thể kết nối Flow.");
});
$("#addCharacter").addEventListener("click", () => {
  project.characters.push({ id: crypto.randomUUID(), name: "", description: "", images: [] });
  persist(); renderCharacters();
  $("#characterList").lastElementChild.querySelector("[data-character-name]").focus();
});
$("#characterList").addEventListener("change", (event) => {
  const id = event.target.dataset.characterImages;
  if (id) addImageFiles(id, event.target.files);
});
$("#characterList").addEventListener("click", (event) => {
  const id = event.target.dataset.removeCharacter;
  if (!id) return;
  project.characters = project.characters.filter((character) => character.id !== id);
  project.scenes.forEach((scene) => { scene.characterIds = scene.characterIds.filter((characterId) => characterId !== id); });
  persist(); render();
});
$("#resetScenes").addEventListener("click", () => {
  project.scenes.forEach((scene) => { scene.status = "pending"; scene.note = ""; });
  setProjectStatus("idle", `Đã đặt lại trạng thái ${project.scenes.length} cảnh.`);
});
$("#importFile").addEventListener("change", async (event) => {
  const file = event.target.files?.[0]; if (!file) return;
  try {
    if (file.name.toLowerCase().endsWith(".json")) {
      const imported = JSON.parse(await file.text());
      if (!Array.isArray(imported.scenes)) throw new Error("JSON cần có danh sách scenes.");
      project = { ...structuredClone(DEFAULT_PROJECT), ...imported, scenes: normalizeImportedScenes(imported.scenes) };
      project.characters = Array.isArray(imported.characters) ? imported.characters : [];
    } else {
      const rows = parseCsv(await file.text());
      if (!rows.length) throw new Error("CSV không có dữ liệu.");
      const imported = scenesFromCsv(rows);
      project.scenes = imported.scenes;
      project.running = false;
      project.status = "idle";
      project.statusMessage = `Đã nhập ${project.scenes.length} cảnh và tự gán nhân vật theo @mention.`;
      persist(); render();
      const characterMessage = imported.importedNames.length ? ` Đã thêm: ${imported.importedNames.map((name) => `@${name}`).join(", ")}.` : "";
      toast(`Đã nhập ${project.scenes.length} cảnh.${characterMessage}`);
      event.target.value = "";
      return;
    }
    persist(); render(); toast("Đã nhập dữ liệu vào dự án.");
  } catch (error) { toast(`Không nhập được file: ${error.message}`); }
  event.target.value = "";
});
$("#exportButton").addEventListener("click", () => downloadFile("flow-scene-director-project.json", JSON.stringify(project, null, 2), "application/json"));
chrome.runtime.onMessage.addListener((message) => {
  if (message?.type === "FLOW_STATUS" && message.sceneId) {
    const scene = project.scenes.find((entry) => entry.id === message.sceneId);
    if (scene && message.status === "scene-done") {
      scene.status = "done";
      if (message.keyframe?.data) scene.keyframe = message.keyframe;
    }
    if (message.status === "scene-done") sceneResultWaiters.get(message.sceneId)?.resolve(message);
    project.statusMessage = message.message || project.statusMessage;
    persist(); render();
  }
  if (message?.type === "FLOW_ERROR") {
    const scene = project.scenes.find((entry) => entry.id === message.sceneId);
    if (scene && message.code !== "NO_CREDITS") scene.status = "error";
    sceneResultWaiters.get(message.sceneId)?.reject(Object.assign(new Error(message.message || "Flow gặp lỗi."), { code: message.code || "FLOW_ERROR" }));
    project.statusMessage = message.message || "Flow gặp lỗi.";
    persist(); render();
  }
});

chrome.storage.local.get("flowSceneDirectorProject").then(({ flowSceneDirectorProject }) => {
  if (flowSceneDirectorProject) {
    project = { ...structuredClone(DEFAULT_PROJECT), ...flowSceneDirectorProject };
    project.scenes = normalizeImportedScenes(flowSceneDirectorProject.scenes || []);
    project.characters ||= [];
    if (project.running) {
      project.running = false;
      project.status = "paused";
      project.statusMessage = "Đã khôi phục dự án. Tiếp tục để chạy từ cảnh chưa hoàn tất.";
    }
  }
  render();
});
