# Flow Scene Director

Chrome Manifest V3 extension for running a CSV-defined sequence of Google Flow scenes.

## Install

1. Open `chrome://extensions` in Chrome.
2. Turn on **Developer mode**.
3. Choose **Load unpacked** and select this folder.
4. Open a Google Flow project at `https://flow.google.com/` (or the legacy `https://labs.google/fx/tools/flow/` URL) in the active tab, then open the extension side panel.

## Use

- Import a CSV. Every non-empty `prompt` row becomes a scene, so the scene count is not fixed.
- Use `@CharacterName` in `prompt`, `characters`, `title`, `dialogue`, or `notes`. The extension creates missing character profiles automatically and assigns them to every matching scene.
- Add visual descriptions and turnaround/reference images to the detected profiles. Re-importing a CSV preserves images for matching character names.
- You can still adjust the automatically selected characters per scene. Use Command-click on macOS or Control-click on Windows to select multiple characters.
- Keep the Flow project open and choose **Start auto-run**. The extension fills the prompt, attaches saved character references when it can identify Flow's image input, generates the opening scene, then uses Extend for later scenes.
- Export a JSON backup at any time. CSV import requires `prompt`; it also supports `scene_number,duration,title,characters,transition,dialogue,notes`.

## Current limits

Google Flow has no public API for this browser workflow. The extension uses visible page controls and text signals, which can change as Flow's interface changes. It stops when it cannot confidently find the prompt, Extend action, image input, generation result, credit warning, or policy message. Credit monitoring runs while the side panel remains open. After a browser restart, reopen the panel and continue from the saved scene.

Character images are resized and stored in Chrome local storage. The extension can attach up to two images for each selected character. It opens Flow's **Add ingredients** / **Upload media** UI when the file input is created lazily, and falls back to a synthetic drop on the prompt composer. The exact attachment flow and Scenebuilder action depend on the current Flow UI and should be checked in the signed-in account before unattended production use.

Generation commands are acknowledged immediately; completion and failure are delivered as separate status events, so a long Veo render does not keep a Chrome message channel open. After a completion signal, the extension waits for a video element to appear or change before continuing and remembers that completed clip as the Extend target. For later scenes it searches for **Extend** inside that clip's card, then opens that card's **More options** menu. This prevents an old Extend action elsewhere on the page from being mistaken for the newly generated clip.

Before the opening scene is submitted, the extension turns off Agent mode when it is active and selects **Video → Veo 3.1 Lite**. Flow currently exposes Extend only for compatible Veo-generated clips; an opening clip generated with Gemini Omni or another unsupported source must be regenerated with a compatible Veo model.
