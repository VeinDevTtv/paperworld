# Paperworld finalization and verification

This document supplements the historical checkpoints in RELEASE_CHECKLIST.md. For the exact current commit, the **Paperworld release checks** workflow on GitHub Actions is the authoritative automated gate. A passing earlier run does not automatically approve a later commit.

## Finishing changes in PR #18

- Comparison is explicitly read-only: the live command/manual workbench is unavailable, paper controls are disabled while its preview remains visible, and mutation callbacks reject changes during preview.
- Entering comparison discards pending/unconfirmed command proposals and prevents queued playback ticks from advancing the live world. Step/example playback is disabled until returning to live. Reset remains an explicit way to discard the run.
- A deterministic explanation identifies the specific deliveries that complete or remain blocked in the two simulated outcomes. It reports losses as well as gains, uses the actual fixed interval, and makes no AI call or real-world efficiency claim.
- The two-minute script in docs/demo-two-minute.md now includes the comparison result and the explicit return to live before voice/text dispatch.
- CI tests the actual production build in Chromium at desktop and narrow viewports, retaining screenshots and machine-readable evidence. Browser tools are installed separately; production dependencies and the project lockfile are unchanged.

## Verified evidence

Baseline main commit c523516 passed GitHub Actions run 38197282306.

PR runtime commit 8a135fc passed run **38198695635**, using synthetic merge f9a901c with the unchanged main base:

| Check | Observed result |
| --- | --- |
| Unit and integration tests | 60 passed, 0 failed/skipped |
| TypeScript | Passed |
| Production build | Passed, Next.js 16.4.0 |
| Source secret scan | Passed, 97 files |
| Source plus built-browser scan | Passed, 110 files |
| Production browser regressions | 4 passed, 0 failed/skipped |
| Evidence artifact | 11 generated files, artifact 11724767005 |

The Step/example-playback follow-up adds a browser assertion to the same suite. Check its associated PR/main workflow result before treating that later commit as passed; these recorded counts are the observed initial run, not a fabricated result for a future commit.

Browser scenarios cover scan/confirm/start, closure and recovery, comparison outcome toggling, live-state preservation, blocked live controls, stale/pending command proposals, explicit provider recovery, and permission-denial handling. The same-package recovery is exercised at 1280px and 390px, including an overflow assertion. Logs and screenshots are attached to each workflow run under `browser-regression-<commit>` for seven days.

## Evidence boundaries

These new browser tests use **synthetic maps and mocked provider responses with the actual production UI and simulation engine**. They do not measure AI quality, live-provider latency, physical webcam/microphone behavior, or real mobile hardware. Capturing a screenshot is not by itself visual approval. Existing physical user reports and earlier live-provider runs remain in docs/interactive-3d-verification.md, clearly distinguished from this CI suite.

No credentials are supplied to browser CI. The paid OpenAI adapter remains disabled and unverified against live billing. Classroom/novice evaluation was deferred by the user and is not claimed. Final presentation-device rehearsal, recording, and hackathon submission are operator actions, not outcomes certified by passing tests. Unpushed local work from another agent is not included in a GitHub release.

## Run the merged release

Preserve `.env` and local uncommitted work. Stop the old local server before starting a new production server. Update using a normal fast-forward pull; do not reset or force-overwrite local changes:

```sh
git switch main
git pull --ff-only
npm ci
npm run build
npm start
```

The application remains bound to 127.0.0.1:3000. Use the local Codex sign-in and TypeSafe key already configured. A public deployment is not part of this release.

For local unit checks: `npm test`, `npm run typecheck`, and `npm run check:secrets`. The production browser suite is reproducible through `.github/workflows/release.yml`; it runs without provider credentials. See docs/demo-two-minute.md for the physical demonstration and labeled fallback plan.
