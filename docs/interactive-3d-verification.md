# Interactive 3D release evidence

In-progress release; final integrated commit and gates remain pending. Prior 2D evidence is not automatically a 3D pass.

## Performed

- Real Three.js WebGL meshes, depth, lighting and shadows inspected in actual renderer PNGs and native browser recordings. The four-stop diorama keeps graph geometry and courier anchors authoritative; buildings sit beside arrival pads.
- Three synthetic raster uploads with live subscription Codex created initial topology, closed J–H, and added S–H. Same courier objects/segment progress survived each accepted edit. `pkg-1` waited at J and completed once at simulation14.666996s; `pkg-2` completed once. Raw states/receipts: `evidence/interactive-3d-live.json`.
- Mocked speech produced an editable transcript with zero inference until Review. Real Jev256ms proposal dispatched urgent `pkg-3`, which completed once. This is not a physical microphone check.
- Live ordered open-road→dispatch routed Jev165ms→Codex4367ms total, validated both commands, and duplicate confirmation created only one `pkg-4`. That package completed once. `evidence/interactive-3d-compound.json`.
- Mocked Jev503 showed Retry / Use Codex with exact unchanged state and one request. Explicit Use Codex made a real5165ms subscription request; reviewed urgent `pkg-3` completed. A late command response after Reset was discarded with no proposal or state mutation. `evidence/interactive-3d-recovery.json` and `evidence/interactive-3d-stale.json`.
- 2D/3D switching, actual WebGL context loss, and mocked WebGL creation failure retained exact serialized simulation state and made zero inference calls. Retry restored the real renderer.
- Mocked reduced-motion preference false→true left camera controls working. Zoom bounded exactly9–38 world units; Reset view restored11/15/16 without changing the run.
- 52 tests, typecheck, production build and source/built-browser secret scan passed on the working head. Later patches require affected gates again.
- Desktop1280×800 command input/Review fit within783px after compact chrome. Narrow390px layout had no overflow and was visually inspected through a native recording frame; narrow camera fitting is being checked separately.

## Performance and failures retained

Available device: Windows, Intel Arc via ANGLE Direct3D11, Ravylo/Electron44.1 Chromium152, DPR1.25. Typical four-stop paused-scene redraw sample362 frames: median6.1ms, p956.2ms,88 draw calls. This is requestAnimationFrame cadence during invalidation, not a GPU timer or a guarantee on other devices.

Initial production maximum fixture32stops/64roads/2couriers: median72.7ms,p9578.9ms,715 calls. Short2.2s measurement retained only7 post-warmup samples. Raw poor result is retained in `evidence/interactive-3d-max-before.json`. After adaptive shadows/change-label reduction, a4.5s production redraw sample732 frames measured median6.1ms,p956.2ms,463 calls,82 geometries/37 textures. Native recording was active to keep the preview compositor producing frames. Host conditions differed, so this is not a controlled causal speedup comparison. `evidence/interactive-3d-max-after.json`.

Native preview screenshots repeatedly timed out. Native recordings and extracted frames were inspected instead; DOM checks alone are not visual approval. One old preview tab stalled during a malformed mock-response attempt; a fresh tab worked, and malformed data correctly produced an incomplete-result error without changing the map. Do not count the stalled attempt as a passed maximum-map check.

Later diagnosis observed zero requestAnimationFrame callbacks while preview recordings were inactive; a fresh recording produced167 frames/~1s and restored sizing/animation. Failed navigation/resize/record requests were retried only after inspecting current state. Resizing within a recording corrupted its encoded frames; that clip is unusable, not backup evidence. A fresh fixed390px recording yielded the inspected mobile frame `evidence/3d-mobile-layout.png`. All sample stops fit the composed camera; small labels can be read by zooming or Inspect. `evidence/3d-renderer-arrivals.png` is a sharp canvas image, not a full-page screenshot.

## Physical and human evidence

User reports all eight physical steps passed in Chrome on the stable 2D release: handwritten webcam capture, reposition/rescan preserving package/positions, road closure/wait, connection/same package completion once, newly drawn home, and dictated delivery to it. Device/version/package ID were not supplied. This is a user report, separate from independently observed synthetic 3D checks. Earlier screenshots corroborate physical dictation/proposal/completion. An actual novice observation remains unperformed; agent walkthroughs are simulated usability review.

Paid API adapter remains disabled/untested. Existing paired benchmark evidence is preserved; renderer-only changes do not alter command/provider behavior. Core final recovery/release checks and a clean complete recording remain pending.
