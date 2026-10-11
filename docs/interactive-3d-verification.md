# Interactive 3D release evidence

Core checkpoint `c0236b3`, integrated main `6884c9d`; comparison integrated runtime `030cdd8`. Prior 2D evidence is not automatically a 3D pass. Separate code and saved-pixel reviews approved the core and comparison; production acceptance repeated on the merged build.

## Performed

- Real Three.js WebGL meshes, depth, lighting and shadows inspected in actual renderer PNGs and native browser recordings. The four-stop diorama keeps graph geometry and courier anchors authoritative; buildings sit beside arrival pads.
- Three synthetic raster uploads with live subscription Codex created initial topology, closed J–H, and added S–H. Same courier objects/segment progress survived each accepted edit. `pkg-1` waited at J and completed once at simulation14.666996s; `pkg-2` completed once. Raw states/receipts: `evidence/interactive-3d-live.json`.
- Mocked speech produced an editable transcript with zero inference until Review. Real Jev256ms proposal dispatched urgent `pkg-3`, which completed once. This is not a physical microphone check.
- Live ordered open-road→dispatch routed Jev165ms→Codex4367ms total, validated both commands, and duplicate confirmation created only one `pkg-4`. That package completed once. `evidence/interactive-3d-compound.json`.
- Mocked Jev503 showed Retry / Use Codex with exact unchanged state and one request. Explicit Use Codex made a real5165ms subscription request; reviewed urgent `pkg-3` completed. A late command response after Reset was discarded with no proposal or state mutation. `evidence/interactive-3d-recovery.json` and `evidence/interactive-3d-stale.json`.
- 2D/3D switching, actual WebGL context loss, and mocked WebGL creation failure retained exact serialized simulation state and made zero inference calls. Retry restored the real renderer.
- Mocked reduced-motion preference false→true left camera controls working. Zoom bounded exactly9–38 world units; Reset view restored11/15/16 without changing the run.
- 52 tests, typecheck, production build and source/built-browser secret scan passed on the working head. Later patches require affected gates again.
- Desktop1280×800 command input/Review fit within783px after compact chrome. Narrow390px layout had no overflow; the composed camera fit the complete board and was visually inspected through a fixed native recording frame.

## Performance and failures retained

Available device: Windows, Intel Arc via ANGLE Direct3D11, Ravylo/Electron44.1 Chromium152, DPR1.25. Typical four-stop paused-scene redraw sample362 frames: median6.1ms, p956.2ms,88 draw calls. This is requestAnimationFrame cadence during invalidation, not a GPU timer or a guarantee on other devices.

Initial production maximum fixture32stops/64roads/2couriers: median72.7ms,p9578.9ms,715 calls. Short2.2s measurement retained only7 post-warmup samples. Raw poor result is retained in `evidence/interactive-3d-max-before.json`. After adaptive shadows/change-label reduction, a4.5s production redraw sample732 frames measured median6.1ms,p956.2ms,463 calls,82 geometries/37 textures. Native recording was active to keep the preview compositor producing frames. Host conditions differed, so this is not a controlled causal speedup comparison. `evidence/interactive-3d-max-after.json`.

Native preview screenshots repeatedly timed out. Native recordings and extracted frames were inspected instead; DOM checks alone are not visual approval. One old preview tab stalled during a malformed mock-response attempt; a fresh tab worked, and malformed data correctly produced an incomplete-result error without changing the map. Do not count the stalled attempt as a passed maximum-map check.

Later diagnosis observed zero requestAnimationFrame callbacks while preview recordings were inactive; a fresh recording produced167 frames/~1s and restored sizing/animation. Failed navigation/resize/record requests were retried only after inspecting current state. Resizing within a recording corrupted its encoded frames; that clip is unusable, not backup evidence. A fresh fixed390px recording yielded the inspected mobile frame `evidence/3d-mobile-layout.png`. All sample stops fit the composed camera; small labels can be read by zooming or Inspect. `evidence/3d-renderer-arrivals.png` is a sharp canvas image, not a full-page screenshot.

## Physical and human evidence

User reports all eight physical steps passed in Chrome on the stable 2D release: handwritten webcam capture, reposition/rescan preserving package/positions, road closure/wait, connection/same package completion once, newly drawn home, and dictated delivery to it. Device/version/package ID were not supplied. This is a user report, separate from independently observed synthetic 3D checks. Earlier screenshots corroborate physical dictation/proposal/completion. An actual novice observation remains unperformed; agent walkthroughs are simulated usability review.

Production port3000 repeat: live Codex6811/6019/6637ms scans; Jev priority161ms and dispatch252ms. Both courier objects stayed exactly equal through closure and reconnection, urgent `pkg-1` waited then completed once, and mocked dictation/live dispatch `pkg-3` completed. Forty subsequent engine steps made zero inference calls. Switching2D/3D retained exact simulation and building-mesh world positions. `evidence/interactive-3d-production.json`.

Native fixed1280×800 recording covers the complete initial scan→closure→reconnection→same package completion→mocked voice/live dispatch sequence. Local backup `.local/evidence/paperworld-3d-production-live.mp4`, SHA256 `C997DF151794FAB641A3F6AC641F16D501BC405D583B0AC808F4F6433E93D983`, approximately174s, silent. Its visible banner identifies synthetic paper/live providers and mocked dictation. Frames are softly compressed, so this is a fallback/evidence recording, not a polished submission video. Extracted completion frame was inspected; renderer-only sharp PNG and mobile frame separately reviewed.

Paid API adapter remains disabled/untested. Existing paired benchmark evidence is preserved; renderer-only changes do not alter command/provider behavior. An actual novice observation remains the human evidence limitation.

## Isolated road comparison

After a road-only accepted edit, Compare road change retains one cloned pre-edit snapshot. Both branches run the existing engine for exactly20 simulation seconds; only one receives the edit. Displayed totals are endpoint deliveries/blocked packages; distance is traveled map units during that window. This is a simulation comparison, not a real-world prediction. Adding or moving stops clears this road-only comparison.

Four regression tests cover deterministic branch outcomes, deep isolation, occupied-segment continuity and invalid/unchanged edits. Replayed scan responses from the earlier live synthetic run produced an actual interactive comparison: without S–H,1 delivered/1 blocked/24.2 distance; with S–H,2 delivered/0 blocked/129.0 distance. Branch toggles and Return to live preserved the exact live state and made zero inference calls. Editing is disabled in preview; Step exited preview and advanced only the live run by1 second. Raw evidence: `evidence/road-comparison-browser.json`. These outcomes are one fixture, not a general improvement claim.

Desktop and fixed390px native recording frames were inspected (`evidence/comparison-desktop.png`, `evidence/comparison-mobile.png`). Mobile table width325.6px, document width375px in390px viewport; no horizontal overflow. Recording compression softens text. Separate reviewer approved code, documentation and both desktop/mobile shown pixels.

## Final integrated runtime030cdd8

56 tests, typecheck, production build and source/built-browser secret scan92 files passed on main. Production restarted only on127.0.0.1:3000; Codex/Jev readiness verified with the same-origin provider endpoint, paid adapter disabled.

Final browser repetition used actual uploads of synthetic paper with explicitly replayed earlier scan responses, and real command requests. Duplicate Start produced exactly two packages. Both complete courier objects stayed exact through closure/reconnection; pkg-1 waited at J and completed once. Comparison preserved exact live state and made zero inference calls. Mocked speech retained an editable transcript without inference until Review; live Jev181ms dispatched pkg-3 and it completed once. Ordered open-road→dispatch used Jev103ms→Codex8034ms total; duplicate confirmation created only pkg-4, which completed once. 2D/3D switches preserved exact serialized state. Raw evidence: `evidence/interactive-3d-final-main.json`.

Mocked HTTP503 preserved the run, offered Retry/Use Codex, and explicit Use Codex made a live4743ms subscription request. Reviewed pkg-5 completed once. `evidence/interactive-3d-final-recovery.json`. Existing stale-response, reset, permission/timeout and context-loss evidence remains applicable to unchanged paths; comparison Reset/Resume/Step tests are in `road-comparison-controls.json`. Final desktop/mobile recorded frames (`3d-final-desktop.png`, `3d-final-mobile.png`) show actual meshes and paper preview; mobile document375px/viewport390px had no horizontal overflow. Saved pixels are soft and are not physical mobile evidence.

One production preview tab timed out after Confirm; app/provider endpoints remained responsive. A fresh native preview tab with a single active recording completed the entire final loop. That interrupted attempt is not counted as a passed run. Backup full core loop remains the labeled174s live-synthetic recording described above; final comparison repetition is replay-labeled evidence.

Independent reviewer approved final raw evidence and shown desktop/mobile pixels. Final screenshots retain the duplicate-start guard notice from the regression check; the command bar is partly below the desktop image edge in that error state. They are verification images, not a clean rehearsal view. Reset clears the notice before rehearsal. The previously approved compact default layout and labeled full-loop backup are separate artifacts.

New-home production check: generated raster with live Codex7086ms added a fifth home and retained both courier objects exactly. Live Jev100ms created urgent pkg-6 to NEW HOME N; it completed once. Adding a stop cleared the road-only comparison. The first fixture accidentally renamed existing labels and produced identity warnings in7401ms; it was not applied. That attempt is retained alongside the stable-label success in `evidence/interactive-3d-new-home.json`. This is synthetic input, not another physical webcam claim.
