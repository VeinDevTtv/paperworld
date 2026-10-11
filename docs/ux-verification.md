# Low-friction demo verification

Frozen candidate; verified fallback main74887ca. Final integrated main gates remain pending.

User requested fewer controls and clicks, automated routine setup, clean main screen and simple access. User deferred the actual novice check; there is no new human usability claim.

Baseline production default at390px:10 visible buttons, one Inspect select, one command textarea; advanced/manual/provider/map-edit panels collapsed. Counts exclude descendants of closed details elements, not merely zero-size rectangles. Actual candidate clicks and pixels must be checked separately from DOM control counts.

Required checks: explicit image submission consent through Upload & scan / Capture & scan; local preparation and readable preview; one request per explicit scan including rapid repeated capture; no inference after stale preparation/reset/cancel; visible permission/provider error and Retry; concise map confirmation plus available corrections; two actual-map deliveries; exact closure/reconnection continuity and same package completion once; typed and mocked-speech review/confirmation; stale proposals; 2D/3D continuity; desktop/mobile saved-pixel inspection; final tests/typecheck/build/secret checks.

## Candidate evidence

Default visible controls fell from10 buttons/1 select/1 textarea to5 buttons/0 selects/1 textarea at390px. View/Inspect and sample playback remain accessible in secondary disclosures; clicking couriers remains direct. The fresh header Scan paper scrolls to the paper panel and focuses Upload & scan, measured at439px in844px mobile viewport. No inference or engine step is caused by that shortcut.

Upload & scan now prepares and scans in one explicit action; camera Capture & scan does the same. Initial upload flow removes one app-button action (Upload→Read→Confirm→Start becomes Upload & scan→Confirm→Start; file-picker selection is unchanged). Camera removes the separate Read step. Both retain mandatory confirmation. Review shows stop types/names and exact open/closed connections; editing stays collapsed unless needed. The small receipt reports provider/task/measured latency, with model detail retained. Sample scanning is explicit and closes the camera.

Replayed synthetic uploads passed scan/confirm/start→closure/wait→reconnection/same pkg-1 completion once. Courier objects remained exact across accepted edits. Compact review was visible without opening the editor. Duplicate map confirmation was guarded synchronously; two map_updated events represented closure/reconnection, with no duplicate third event. Duplicate Start produced exactly2 packages and no lingering guard alert after the correction. `evidence/ux-recovery-loop.json`.

Mocked device/async checks: permission denial made no inference call; duplicate Open made1 getUserMedia call; duplicate Capture made1 scan, stopped the stream, and left the world unchanged before confirmation. Late capture after Close camera made0 calls and preserved state. Rapid file selections made1 scan. Preparation after Reset, sample fetch after Reset, and scan response after Reset produced no proposal/state mutation. `evidence/ux-input-races.json`. These are not additional physical webcam results.

56 tests, typecheck, production build and source/built-browser secret scan106 files passed on the frozen candidate. Saved default mobile/desktop and latest map-review desktop recording frame were inspected. Initial post-scan confirmation bottom773px in800px desktop viewport; mobile after scrolling review placed Confirm at530px, document375px in390px viewport. `evidence/ux-map-review-desktop.png` is the current desktop review frame; `ux-map-review-mobile.png` is an actual native PNG snapshot after native scrolling. An earlier mobile recording stayed at the default view despite DOM scroll measurements, so it was not used to approve the review panel. Earlier ux-after-desktop shows the interim button row, superseded by the latest review image. Recording compression softens text. Native recording failed on one tab; a fresh preview and native scroll/snapshot completed the mobile check. DOM counts are not visual approval.
