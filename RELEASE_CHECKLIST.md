# Paperworld release gate

Current baseline: `bfdc341`. This checklist tracks the new release; previous evidence is in docs/polish-verification.md and does not automatically pass this gate.

| Gate | Status | Evidence / next action |
| --- | --- | --- |
| Ordered compound commands | PASS | Reproduced open→dispatch failure; evolving scratch state, road/assignment/capacity/rollback/continuity regressions; independent review |
| Local photo preparation | PASS: SYNTHETIC | EXIF6 1.79 MB→636 KB; upright readable preview pixels inspected; live scans passed; user-reported handwritten recovery recorded separately; compression proof synthetic |
| Dictation state and recovery | PASS: MOCKED + USER PHYSICAL | Listening/processing/error/retry/late-old-end mocked; user physical transcript, proposal and pkg-4 completion screenshots; Brave network failure retained |
| Provider failure and duplicate/stale actions | PASS: CODE + MOCKED UI | Jev network/429/timeout no fallback; double preview1 call; double confirm1 package; reset/stale flows; accelerated90sec scan transport timeout/late response with live retry passed |
| Paired routing benchmark | PASS: SMALL LIVE SAMPLE | Final12 requests×2 modes=24/24 exact outcomes; earlier5+5 failures retained; isolated post-fix timeout; docs/benchmark.md |
| Educator novice feedback | SIMULATED REVIEW; HUMAN NOT TRIED | Agent walkthrough found Resume versus Start hesitation; header action corrected. No human/classroom validation. User physical task requested again for 3D release. |
| Physical handwriting/webcam and camera reposition | PASS: USER PHYSICAL REPORT | User reports all eight Chrome steps passed: webcam handwritten scan, reposition with exact continuity, closure/wait, connection/same package completed once, new home and dictated delivery. Device/version/package ID unreported; this was the stable 2D release, separate from 3D synthetic evidence |
| Physical microphone | PASS: USER PHYSICAL | User reported Dictate worked; screenshots show dictated Depot to North shop proposal then pkg-4 Delivery complete, Delivered1 Waiting0; successful browser appears Chrome, version/device unreported |
| Optional paid API adapter | NOT RUN | No billing authorization; disabled |
| Current official cost assumptions | PASS | Official pricing checked2026-10-11; illustrative$0.0854/session,$0.1068 with25% retry; not measured subscription billing; docs/submission.md |
| All tests / typecheck / production build | PASS: INTEGRATED | 49 tests, typecheck, production build passed on final runtime1a9588e; production localhost health and mobile layout rechecked |
| Source and built-browser secret checks | PASS: INTEGRATED | Source + built assets68 files scanned after final build; no secrets found |
| Desktop / mobile screenshots and browser loop | PASS: BROWSER EMULATION | Production live synthetic scan/closure/same urgent pkg-1 recovery completed; text and mocked voice/live inference delivered; desktop/mobile DOM checks; user desktop screenshots inspected; 66s fixed-viewport backup recovered, labeled synthetic/live; some frames soft; 390px mobile screenshots captured/inspected with independent visual approval; no physical mobile claim |
| Final independent review / commit | APPROVED | Separate reviewer approved code/schema/benchmark/cost and spoken parser; root sole integrator; final gates recorded below |
| Rehearsal / submission reserve | SET | User deadline8pm Pacific2026-10-11; reserve6:30-8pm local. User said PST; following local Pacific clock unless organizer specifies fixed UTC-8 |

Evidence labels: physical = actual device/paper; synthetic = generated raster with live inference; mocked = substituted browser/provider behavior; replayed = recorded response reused. DOM checks are not visual approval.

## Active goal amendment: interactive 3D

User explicitly replaced the earlier no-3D constraint on 2026-10-11. Required: actual Three.js meshes/light/shadows, bounded orbit/zoom, authoritative-engine positions, accepted-change animations, selection, 2D fallback/context-loss recovery, no inference on view switches, reduced motion, measured performance, and full integrated release gates. Core timebox two hours, polish45 minutes; comparison45 minutes only after core acceptance. Feature freeze remains6:30pm Pacific, submission8pm. Renderer/UI owner input; root integration/tests/docs/dependencies; separate reviewer. Comparison is a stretch, not a substitute for the core loop.

3D core checkpoint `c0236b3`: PASS live synthetic production recovery (same urgent pkg-1 completed once), text and mocked voice/live dispatch, duplicate start/confirmation, stale reset response, explicit provider recovery, bounded orbit/zoom, reduced-motion toggle, exact2D/3D/context-loss continuity. 52 tests/typecheck/build/source+built-secret checks passed; separate code and actual saved-pixel reviews approved. Maximum32stop/64road fixture measured732 frames median6.1ms,p956.2 on available Arc device with adaptive effects and active recording; earlier slow sample retained, no causal speedup claim. Full raw evidence and soft labeled174s backup: docs/interactive-3d-verification.md. Final main integration gates remain pending; optional comparison starts only after this checkpoint. Human novice not tried.

Checkpoint before 3D: 49 tests and typecheck pass; synthetic canvas camera capture through actual camera controls, reposition/closure/reconnection preserved package IDs and exact courier transforms; pkg-1 completed once0:12, new home accepted and urgent pkg-3 completed0:39. Six live Codex scans include one repeated closure after uncertain browser-host response; live Jev dispatch130ms. Raw evidence: docs/evidence/synthetic-camera.json. Fixture initial-frame issue corrected with repaint/frame pump. Mobile390px Start label/no-overflow and duplicate-start two-package state verified by DOM; screenshot capture timed out, so no new visual approval claimed.
