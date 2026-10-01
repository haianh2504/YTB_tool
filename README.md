# Flow Scene Director

Chrome Manifest V3 extension for running a CSV-defined sequence of Google Flow scenes.

## Install

1. Open `chrome://extensions` in Chrome.
2. Turn on **Developer mode**.
3. Choose **Load unpacked** and select this folder.
4. Open a Google Flow project at `https://flow.google.com/` (or the legacy `https://labs.google/fx/tools/flow/` URL) in the active tab, then open the extension side panel.

## Use

- Import a CSV. Every non-empty `prompt` row becomes a scene, so the scene count is not fixed.
- Put `@CharacterName` in `prompt` or `characters` to keep character names explicit. The extension preserves those mentions in the prompt and adds a character-continuity instruction; it no longer maintains a character library or per-character image profiles.
- Put character appearance descriptions directly in each scene's `prompt` and show visual references in that scene's Canva/composite image. Later scenes also receive the previous clip's `@last_keyframe`.
- Import one Canva/composite reference image in every scene card. Scene 1 uses its scene image; each later scene also receives `@last_keyframe`, automatically captured from the previous completed clip.
- Keep the extension side panel open and choose **Start auto-run**. The Flow tab is pinned for the run, so you can switch to YouTube or another tab without sending the automation to that tab. Use the square stop button to cancel the active scene.
- Export a JSON backup at any time. CSV import requires `prompt`; it also supports `scene_number,duration,title,characters,transition,dialogue,reference_images,notes`. Put `@last_keyframe` in `reference_images` from scene 2 onward; the extension treats it as an image alias, not a character.

## Current limits

Google Flow has no public API for this browser workflow. The extension uses visible page controls and text signals, which can change as Flow's interface changes. It stops when it cannot confidently find the prompt, Extend action, image input, generation result, credit warning, or policy message. Keep the side panel open while switching tabs; background tabs may be throttled by Chrome, so progress updates can arrive later than in the foreground. The pinned Flow tab is not activated during generation.

Scene-composite images are resized and stored in Chrome local storage. The extension opens Flow's **Add ingredients** / **Upload media** UI when the file input is created lazily, and falls back to a synthetic drop on the prompt composer. It captures the completed clip's last frame through the page video element and saves it in the project as `@last_keyframe`; if browser canvas security prevents capture, the workflow stops rather than silently generating a scene without continuity.

Veo 3.1 Lite currently supports Ingredients/References only for 8-second videos. The runner stops before sending a referenced scene with an explicit non-8-second duration rather than silently changing the requested length.

Generation commands are acknowledged immediately; completion and failure are delivered as separate status events, so a long Veo render does not keep a Chrome message channel open. Scene progress and captured keyframes are persisted even if the side panel is reopened. Google Flow's current extension/ingredients workflows can change; validate one scene in the signed-in account before unattended production.

Before the opening scene is submitted, the extension turns off Agent mode when it is active and selects **Video → Veo 3.1 Lite**. Flow currently exposes Extend only for compatible Veo-generated clips; an opening clip generated with Gemini Omni or another unsupported source must be regenerated with a compatible Veo model.
