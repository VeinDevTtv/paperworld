# Paperworld

A localhost-only hackathon app that turns a labeled paper drawing into a miniature paper town with working couriers. Next.js, TypeScript, Tailwind, Three.js and React Three Fiber; Node handles providers. A working 2D SVG view remains available. No accounts, database or billing subsystem. MIT licensed.

## Start

Requires Node.js 22 or newer, npm, and the official Codex CLI signed in with ChatGPT for drawing scans and compound commands.

```powershell
npm ci
# Only if you do not already have a local .env:
Copy-Item .env.example .env
# Install the official CLI if needed:
npm install -g @openai/codex
codex login
npm run dev
```

Open **http://127.0.0.1:3000**. The server binds to loopback. Existing local `.env` files should be preserved; do not overwrite them. Sample mode works without provider credentials. For Jev text commands, set `TYPESAFE_API_KEY` in your local `.env` and restart the server.

```powershell
npm test
npm run typecheck
npm run build
npm start
# Real provider requests, explicit manual checks:
npm run smoke:providers
```

`npm start` also binds to 127.0.0.1. Never expose this trusted local app through a tunnel or deploy it publicly.

## Draw and scan

Use clearly labeled stops: write a stable short ID and a name beside each **DEPOT**, **HOME**, **SHOP** or **JUNCTION**. Draw a continuous line between two stops for a bidirectional road. Mark a road with a large **red X** to close it. Connections must terminate at labeled stops; unlabeled crossings are not intersections. Keep IDs unchanged on every rescan. Use a well-lit, flat photo with readable labels.

Choose **Upload & scan** for PNG, JPEG or WebP, or **Use camera → Capture & scan**. These explicit scan actions send the selected image after local preparation; opening the camera alone sends nothing. Larger supported uploads use EXIF-aware resizing/compression to fit the existing 1.5 MB cap. Check readable labels, open/closed connections and the proposed map before confirming; correction tools stay under **Adjust map**. The first confirmed drawing starts a fresh world; later rescans preserve courier/package state. Coordinates of matched existing locations stay fixed, so photo perspective drift cannot move a courier. Removing or moving a location referenced by simulation state is rejected. Model transcription can be wrong; manual correction is part of the workflow.

After confirming the first map, choose **Start deliveries**. Code creates two clearly labeled demo deliveries from reachable stops on that actual map and dispatches two couriers. Rescans preserve these packages and their physical progress. Manual dispatch is optional in a secondary panel. Change priority to urgent to change the courier's next task. A courier already on a road finishes its pinned physical segment even if that road closes or disappears, then reroutes. If its destination becomes unreachable it waits; a new connecting road can resume the same delivery. Only physical arrival completes a delivery.

## Providers and privacy

Default: the official installed Codex CLI reuses its supported local ChatGPT sign-in. Paperworld never reads login tokens. Each inference runs in an isolated temporary directory, with shell/patch/web tools disabled, saved configuration ignored, a strict output schema and time/byte limits. API credentials are excluded from its child environment. Temporary images/results are cleaned after calls.

Jev uses the [official TypeSafe API](https://docs.typesafe.ai/api) for fixed intent/priority choices. Code validates targets and applies commands atomically; Jev does not perform arithmetic, routing or difficulty judgments. The main command bar routes supported task categories automatically: Jev handles narrow operations; Codex handles compound instructions. Routing does not estimate difficulty. A typed create-and-dispatch operation lets code allocate package IDs and validate capacity in one reviewed request. No model calls run on animation frames. Model latency is measured on each request.

**Localhost-only does not mean offline inference:** selected images and command context are sent to the chosen provider. Browser speech recognition may use your browser vendor's online transcription service; voice is opt-in, and the transcript is editable before submission. Camera/voice depend on browser permission and device support. Neither personal photos nor simulation state are persisted in a database.

The optional paid OpenAI Responses adapter requires both `PAPERWORLD_OPENAI_PROVIDER=api` and `PAPERWORLD_ALLOW_PAID_API=true`, plus `OPENAI_API_KEY` and an explicit currently supported `OPENAI_MODEL`. It never activates as a fallback. This adapter is not needed for the default subscription workflow.

`.env`, `.env.*` (except `.env.example`), build output, dependencies and local artifacts are ignored. Keep keys server-side; do not put them in `NEXT_PUBLIC_*` variables. Provider routes enforce loopback Host and same-origin browser requests, cap body/output sizes and concurrency, rate-limit requests and return sanitized errors. This is a trusted-machine hackathon MVP, not a hardened shared service.

## Verification and demo

See [provider evidence](docs/provider-smoke.md), [acceptance evidence](docs/acceptance.md), [polish verification](docs/polish-verification.md) and [demo script](docs/demo.md). Automated tests cover deterministic movement, closure and rescan continuity, capacity, priority, unreachable recovery and atomic invalid actions.

Official integration references: [Codex non-interactive output schemas](https://developers.openai.com/codex/noninteractive), [Codex authentication](https://developers.openai.com/codex/auth), [TypeSafe HTTP contract](https://docs.typesafe.ai/api).

For a quick repeatable scan demo, open `/demo/initial.png`, `/demo/blocked.png` and `/demo/reconnected.png` on the localhost app and save them for upload in that order. These are generated test drawings, not a substitute for testing your own paper sketch. `npm run acceptance` performs real provider calls and verifies the same closure/recovery sequence automatically. `npm run check:secrets` checks source before pushing.

The reliability release adds local photo compression under the existing 1.5 MB scan cap, EXIF-aware preparation, compact Delivered/Waiting counts, brief recovery/completion feedback, and visible dictation states with Retry. Ordered compound commands validate against an evolving scratch world before atomic confirmation. Jev failure offers Retry or explicit subscription-only Use Codex; no paid fallback activates silently.

See [release checklist](RELEASE_CHECKLIST.md), [current evidence](docs/release-verification.md), [paired benchmark](docs/benchmark.md), and [educator demo/architecture/cost notes](docs/submission.md). Reproduce synthetic rotated-photo fixtures with `npx tsx scripts/photo-fixtures.ts`; files go to ignored `.local/photo-fixtures`. Run the paired live benchmark with `npx tsx scripts/benchmark.ts --live` (subscription/Jev only). After production build, scan source plus browser assets with `npx tsx scripts/check-secrets.ts --browser`.

User reports the complete handwritten webcam/reposition/closure/reconnection loop and delivery to a newly drawn home passed in Chrome on the stable 2D release. Physical dictation/dispatch/completion also has screenshots. Device/version/package ID were not supplied; this is user-reported evidence, separate from independently observed synthetic 3D checks. Actual novice feedback and the optional paid API adapter remain unperformed. Brave speech-service network failure is retained. Mocked checks do not establish hardware success.

After confirming a road-only edit, open **Compare road change → Compare latest road change**. Switch **Without change / With change** to see isolated outcomes over the same20 simulation seconds, then **Return to live world**. The live run stays paused and unchanged; Resume returns to it. Counts describe endpoint outcomes and distance uses map units. This simulation comparison makes no model calls and is not a real-world prediction. See [3D evidence](docs/interactive-3d-verification.md).
