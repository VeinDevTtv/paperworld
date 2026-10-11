# Paperworld release gate

Current baseline: `bfdc341`. This checklist tracks the new release; previous evidence is in docs/polish-verification.md and does not automatically pass this gate.

| Gate | Status | Evidence / next action |
| --- | --- | --- |
| Ordered compound commands | PASS | Reproduced open→dispatch failure; evolving scratch state, road/assignment/capacity/rollback/continuity regressions; independent review |
| Local photo preparation | PASS: SYNTHETIC | EXIF6 1.79 MB→636 KB; upright readable preview pixels inspected; live scans passed; physical handwriting not established |
| Dictation state and recovery | PASS: MOCKED / PHYSICAL RETEST | Listening/processing/network error/retry/late-old-end tested; actual user network failure remains |
| Provider failure and duplicate/stale actions | PASS: CODE + MOCKED UI | Jev network/429/timeout no fallback; double preview1 call; double confirm1 package; final production reset/stale gate below |
| Paired routing benchmark | PASS: SMALL LIVE SAMPLE | Final12 requests×2 modes=24/24 exact outcomes; earlier5+5 failures retained; isolated post-fix timeout; docs/benchmark.md |
| Educator novice feedback | BLOCKED: USER | Requested novice task and actual observations; no feedback yet |
| Physical handwriting/webcam and camera reposition | BLOCKED: DEVICE | Requested complete paper loop plus new home/reposition; no verified result yet |
| Physical microphone | FAILED / RETEST | Network recognition failure reported; new state/retry UI implemented; physical success not yet reported |
| Optional paid API adapter | NOT RUN | No billing authorization; disabled |
| Current official cost assumptions | PASS | Official pricing checked2026-10-11; illustrative$0.0854/session,$0.1068 with25% retry; not measured subscription billing; docs/submission.md |
| All tests / typecheck / production build | PASS: CANDIDATE / FINAL RERUN PENDING | 47 tests/typecheck passed; latest build passed; final commit gate to follow |
| Source and built-browser secret checks | PASS: CANDIDATE / FINAL RERUN PENDING | Source+64 files including built assets scanned, no secrets found; final build rerun required |
| Desktop / mobile screenshots and browser loop | PARTIAL | Live dev EXIF recovery+newhome+mock voice/live dispatch passed; final production loop pending; baseline1280px screenshot inspected; later screenshot/recording host failures |
| Final independent review / commit | IN REVIEW | Separate reviewer approves code/schema/benchmark/cost; root sole integrator; documentation/final production gate in progress |
| Rehearsal / submission reserve | UNKNOWN | Submission deadline requested; reserve final 90 minutes once supplied |

Evidence labels: physical = actual device/paper; synthetic = generated raster with live inference; mocked = substituted browser/provider behavior; replayed = recorded response reused. DOM checks are not visual approval.
