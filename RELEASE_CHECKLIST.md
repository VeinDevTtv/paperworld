# Paperworld release gate

Current baseline: `bfdc341`. This checklist tracks the new release; previous evidence is in docs/polish-verification.md and does not automatically pass this gate.

| Gate | Status | Evidence / next action |
| --- | --- | --- |
| Ordered compound commands | PASS | Reproduced open→dispatch failure; evolving scratch state, road/assignment/capacity/rollback/continuity regressions; independent review |
| Local photo preparation | PASS: SYNTHETIC | EXIF6 1.79 MB→636 KB; upright readable preview pixels inspected; live scans passed; physical handwriting not established |
| Dictation state and recovery | PASS: MOCKED + USER PHYSICAL | Listening/processing/error/retry/late-old-end mocked; user physical transcript, proposal and pkg-4 completion screenshots; Brave network failure retained |
| Provider failure and duplicate/stale actions | PASS: CODE + MOCKED UI | Jev network/429/timeout no fallback; double preview1 call; double confirm1 package; reset/stale flows; accelerated90sec scan transport timeout/late response with live retry passed |
| Paired routing benchmark | PASS: SMALL LIVE SAMPLE | Final12 requests×2 modes=24/24 exact outcomes; earlier5+5 failures retained; isolated post-fix timeout; docs/benchmark.md |
| Educator novice feedback | BLOCKED: USER | Requested novice task and actual observations; no feedback yet |
| Physical handwriting/webcam and camera reposition | PARTIAL: USER PHYSICAL | User reports handwritten closure/recovery works; independent synthetic live repeat passed (same pkg-1 delivered once0:14); webcam/new home/reposition not separately established |
| Physical microphone | PASS: USER PHYSICAL | User reported Dictate worked; screenshots show dictated Depot to North shop proposal then pkg-4 Delivery complete, Delivered1 Waiting0; successful browser appears Chrome, version/device unreported |
| Optional paid API adapter | NOT RUN | No billing authorization; disabled |
| Current official cost assumptions | PASS | Official pricing checked2026-10-11; illustrative$0.0854/session,$0.1068 with25% retry; not measured subscription billing; docs/submission.md |
| All tests / typecheck / production build | PASS: INTEGRATED | 48 tests, typecheck, production build passed on integrated2059048; latest documentation correction does not change runtime |
| Source and built-browser secret checks | PASS: INTEGRATED | Source + built assets63 files scanned after final build; no secrets found |
| Desktop / mobile screenshots and browser loop | PARTIAL | Production live synthetic scan/closure/same urgent pkg-1 recovery completed; text and mocked voice/live inference delivered; desktop/mobile DOM checks; user desktop screenshots inspected; 66s fixed-viewport backup recovered, labeled synthetic/live; some frames soft; mobile screenshot capture still fails |
| Final independent review / commit | APPROVED | Separate reviewer approved code/schema/benchmark/cost and spoken parser; root sole integrator; final gates recorded below |
| Rehearsal / submission reserve | SET | User deadline8pm Pacific2026-10-11; reserve6:30-8pm local. User said PST; following local Pacific clock unless organizer specifies fixed UTC-8 |

Evidence labels: physical = actual device/paper; synthetic = generated raster with live inference; mocked = substituted browser/provider behavior; replayed = recorded response reused. DOM checks are not visual approval.
