# Reliability release evidence — 2026-10-11

This extends the previous integrated baseline bfdc341. Root integrates; compound agent owns server/providers.ts/tests/providers.test.ts; input agent owns input components/photo helper/test/generator; separate read-only reviewer approves logic, input lifecycle and benchmark. No paid API adapter calls, new infrastructure or public deployment.

## Live browser run (development build, native Ravylo preview)

Generated EXIF6 JPEG initial source 1,789,490 bytes was compressed locally to 636 KB, decoded upright 2286×3200. A browser canvas preview of the selected image was visually inspected: ORIENTATION: TOP was upright and Depot D/Junction J/Home H/Shop S were readable. This inspects image pixels, not the whole UI screenshot. Live Codex parsed four stops/three roads in 8,060 ms.

Confirmed map → Start deliveries; reset once because the first pause occurred after couriers entered the home/shop branches. Restart with a timed early pause. Closure input compressed to646 KB, live Codex7,294 ms. Confirm changes preserved both transforms exactly at `translate(500 178.268)`. After three one-second steps Mina waited at Junction with pkg-1; inspector showed Depot D→Home H and “No open route to destination; package is waiting.” Waiting counter1 and CHANGED road label appeared.

Live Jev priority proposal145 ms, model jev-1.13.0; confirmed pkg-1 urgent. Recovery image651 KB, Codex9,754 ms, four stops/four roads. Both positions preserved exactly: Mina `translate(500 301.808)`; Rook `translate(523.2295271690523 311.56580926113344)`. “pkg-1 - Route restored” appeared. Twelve one-second steps delivered the same urgent pkg-1 once at0:13, pkg-2 at0:06. Delivered2, Waiting0. No model calls on steps.

Synthetic new-home photo651 KB parsed five stops/four roads in8,072 ms. It was based on the initial network plus S–N, so replacing the recovered map correctly raised `previous_roads_not_confidently_matched`; proposal was reviewed before confirmation. Live Jev119 ms created/dispatched urgent pkg-3 Depot D→New Home N. Double confirmation in one browser task created exactly one package: total3. Twenty-five steps completed pkg-3 at0:31; “Delivery complete” appeared.

## Resilience and speech (mocked browser input, live recovery)

Mock recognition showed Listening, Processing, Error after network failure; transcript stayed editable and package count stayed3. Retry started a new session; old onend did not stop it. A double form submission under a mocked Jev502 made one request, no simulation change, and visible Retry/Use Codex. Explicit Use Codex sent mode=codex, with live subscription proposal4,420 ms; confirmed urgent pkg-4 Depot D→Shop S completed at0:56. This is mocked transcription plus real command inference, not microphone validation.

Unit/provider regressions include open-road→dispatch, close-road→dispatch, existing assignment→dispatch, capacity/rollback, occupied-segment continuity; network/429/timeout failures never invoke silent fallback. Explicit Codex and auto compound stay subscription-only even when paid flags exist. Available Jev/router usage is retained.

## Provider reliability

See benchmark.md and raw outcomes. Earlier paired runs had provider failures; isolated diagnostics identified intermittent strict-schema400 rejection of const-only command discriminators. Typed singleton enums fixed that boundary; final paired24/24 outcomes passed. A separate post-fix isolated probe still timed out at75,066 ms (7/8 valid). Provider uptime is not guaranteed; timeout/retry feedback remains necessary.

## Gate and device limits

47 tests/typecheck/build/source and built-browser secret checks passed during integration; final commit checks and production browser evidence are tracked in RELEASE_CHECKLIST.md. No loaded credential values printed or found in scanned browser assets.

One full baseline screenshot was captured/inspected at1280×800 before edits. Later native snapshot/click/recording calls intermittently timed out or failed PreviewAutomationExecutionError; evaluate and type remained available. Do not claim final visual approval or a backup recording from failed capture attempts. DOM/no-overflow checks are not visual approval.

User physically reported “Speech recognition stopped (network),” then the new network guidance again; confirmed browser **Brave**, device/version not reported. User later reported Dictate worked. Screenshots show retained physical transcript, a Jev93 ms urgent Depot to North shop proposal, and after confirmation pkg-4 Delivery complete, Delivered1, Waiting0. This verifies user-reported physical dictation/review/confirm/delivery on the sample map. The successful browser appears Google Chrome; version and device were not supplied. Brave network failure remains recorded. [Brave's official on-device speech tracker](https://github.com/brave/brave-browser/issues/56487) remained open/work-in-progress on2026-10-11, supporting a browser-service limitation hypothesis, not proof of the exact account/device cause. UI now suggests Google Chrome or Windows Win+H rather than endless retry. User-reported handwritten recovery is recorded below; arbitrary handwriting, physical webcam, camera repositioning and educator novice feedback are not separately established. Generated EXIF images/new home establish synthetic scan behavior only. Paid API adapter disabled and untested without billing authorization.

## Production browser acceptance

Raw receipts and state evidence: [production-browser.json](evidence/production-browser.json), runtime implementation 8eed8ac. Live synthetic PNG scans: initial7190 ms, closure7809 ms, recovery7146 ms. Closure and recovery preserved both exact courier transforms. The same urgent pkg-1 completed once at0:13; pkg-2 at0:07. Live Jev189 ms priority;115 ms text dispatch;110 ms mocked-transcript dispatch. Four packages ultimately delivered, Waiting0. Duplicate confirmation created one package.

Mock permission denial, stale command/scan after reset, late speech after reset and accelerated90-second client timeout preserved state and provided visible recovery. Desktop1440x900 and mobile390x844 had no horizontal overflow; these are DOM checks. User-provided desktop screenshots were visually inspected, including proposal and delivery completion. Full final mobile visual approval remains unperformed.

Native recording eventually stopped and produced a16.7-minute MP4, but inspected extracted frames show severe codec corruption/degradation. It is not an approved backup or submission-ready recording. Operator should record a clean two-minute rehearsal separately; no physical paper or webcam footage exists.

Final spoken-parser production probe: typed omitted-from request `send an urgent delivery Depot to North Shop` produced a live Jev171 ms valid urgent Depot to North shop proposal. This is text-provider evidence; physical voice completion above is user-provided evidence. Latest paired24/24 outcomes,48 tests, typecheck, production build and source/built-browser secret scan63 files passed after the parser fix.

## Final integrated repeat and user paper feedback

On2059048, independently repeated initial scan7364 ms, closure6590 ms, added-connection scan6761 ms with live Codex and synthetic PNGs. Both confirmations preserved exact courier positions. pkg-1 waited, route restored at0:04, then the same pkg-1 delivered once at0:14; pkg-2 delivered0:07. Final Delivered2 Waiting0. Raw [final-recovery.json](evidence/final-recovery.json). Preview evaluate timed out during confirmation/steps but subsequent inspection verified completion; no result inferred from the timeout.

User separately reported the handwritten closure/recovery loop works correctly. This is user-reported physical evidence, not agent-operated hardware. Webcam/new-home/reposition and novice feedback were not separately supplied. Deadline supplied8pm Pacific; reserve6:30-8pm for rehearsal/submission. Final integrated2059048 passed48 tests, typecheck, production build and source/built-browser secret scan63 files.

## Scan transport resilience follow-up

Audit identified a browser connection hang beyond the existing provider timeout. Scan now races fetch and response JSON against90 seconds, clears timers on reset/new photo/unmount, retains the world, exposes Read paper map retry, and prevents duplicate requests. Separate reviewer approved. Browser mocked test accelerates90 seconds to30 ms: double click1 request, timeout visible, retry enabled, seven-stop world unchanged, no confirmation; late successful mocked response ignored even when fetch ignores abort. This is accelerated transport evidence, not a real90-second provider wait.

Fresh native preview tab captured a soft1280x800 desktop screenshot and was visually inspected. Mobile capture still fails after resize; no mobile screenshot approval. New recording start timed out and stop failed; no approved backup resulted.

After accelerated timeout, restored native fetch and real timers; Read paper map retried live Codex successfully in7503 ms (four stops/three roads, confirmation available, error cleared).48 tests/typecheck/build and source/built-browser64-file secret scan passed for the scan follow-up.

## Native-size oversized image and recovered backup

Browser-generated1000x1000 noisy PNG2,935,327 bytes compressed locally to842 KB JPEG with1000x1000 intrinsic dimensions unchanged. Earlier implementation skipped encoding for images below1200 pixels; helper now attempts native-size compression. Larger images retain the1200-pixel downsampling floor. Three photo regressions/typecheck independently reviewed. This is synthetic browser decode/encode evidence, not handwriting proof.

A later fixed-viewport native capture succeeded:66-second synthetic-photo/live Codex+Jev recovery, visible evidence label, initial7903 ms, closure6906 ms, priority161 ms, recovery7041 ms. Same urgent pkg-1 completed once0:14; pkg-2 at0:07; both rescan positions exact. Native variable timestamps normalized to30fps MP4; full decode of normalized file emitted no errors. Frames20/40/60 seconds inspected: priority screen readable, some world frames soft, no previous severe corruption. Backup is local `.local/evidence/paperworld-backup-synthetic-live.mp4` (no audio), useful as a fallback core-loop clip rather than a polished two-minute submission. It contains no physical camera or microphone demonstration. Original corrupted recording remains excluded.

Post-scan-follow-up production raw evidence: [scan-followup-production.json](evidence/scan-followup-production.json), runtimeb6b8b3f. Repeated priority and full same-package recovery; mocked speech transcript plus real Jev226 ms dispatch created pkg-3 and completed0:41. Total3 delivered, Waiting0. No physical speech claim from this mock. Existing user screenshots remain the physical evidence.
