# Paperworld: teach networks by changing paper

Paperworld is a classroom demonstration for educators teaching connectivity, route planning, and disruption. Learners draw a small network, confirm the interpreted graph, launch two deliveries, and predict what a road closure will do. Adding a connection makes the same waiting package recover. A text or voice transcript can change priority or request a new delivery. Learning effectiveness is a hypothesis; no novice or classroom validation has been reported yet.

## Architecture

Browser photo preparation → explicit scan request → local Node/Codex subscription image interpretation → typed map review → confirmation → deterministic TypeScript simulation → Three.js paper diorama (or 2D SVG fallback).

Text or reviewed speech transcript → Jev supported-operation classifier → fixed narrow command conversion or subscription Codex compound planner → typed entity validation → evolving scratch simulation → user confirmation → atomic commit. Code owns IDs, capacity, shortest paths, positions, pickup and completion. No inference runs per animation frame. Jev failure offers Retry or an explicit Use Codex action; it never silently activates the optional paid adapter.

The client renderer uses pinned Three.js 0.186.1 and React Three Fiber 9.8.1 with React 19. One authoritative simulation clock owns movement; normalized graph coordinates map onto the ground plane. Presentation effects never advance the engine. Accepted scans animate buildings/roads, accepted changes highlight connections, and real completion events trigger brief feedback. Orbit/zoom are bounded; Reset view changes only the camera. Switching views or recovering from WebGL loss preserves the run and makes no inference calls.

Camera and browser speech recognition are device/browser services. Speech may use a browser vendor network service. The app binds only to localhost, but inference is online. No database, accounts, public deployment, or extra infrastructure.

## Results and limits

Use RELEASE_CHECKLIST.md for this release's exact evidence. docs/polish-verification.md contains prior live Codex/Jev runs on generated drawings and clearly labeled replays. New paired benchmark JSON files retain every attempt, including provider failures. Generated drawings do not prove handwriting recognition; mocked speech does not prove physical transcription. User reported a successful handwritten recovery loop and supplied physical dictation/dispatch/completion screenshots; Brave speech-service network failure remains recorded. Physical webcam/new-home/reposition and novice feedback must be reported separately. Mobile390px browser-emulation screenshots were independently visually reviewed; this is not physical phone evidence.

## Representative API cost, not the current billing path

Checked 2026-10-11 using [official GPT-5.4 model pricing](https://developers.openai.com/api/docs/models/gpt-5.4) and [official TypeSafe models/pricing](https://docs.typesafe.ai/models). GPT-5.4 is an illustrative API option, not an assertion of the actual Codex model. Standard uncached prices used: $2.50/M input and $15/M output; Jev $0.042/M input with free output.

Assume one teaching session has 3 scans (each 4,000 combined image/text input tokens and 800 output tokens), 2 compound commands (each 2,000 input and 300 output), and 8 Jev routing/narrow calls (each 1,200 input). GPT total: 16,000 input + 3,000 output = $0.085. Jev: 9,600 input = $0.0004032. Total approximately **$0.0854/session**, or **$0.1068** with a 25% retry allowance. Image resolution/detail, reasoning output, actual model, retries and larger contexts can change this materially. These token counts are assumptions, not measured image usage; hosting, browser transcription and taxes are excluded.

The current demo uses the user's Codex subscription and user-reported unlimited Jev access; no paid OpenAI API call is needed or authorized. Subscription fees/limits still exist. This is not evidence of zero-cost production access, nor proof the optional API adapter works.

## Two-minute presentation

| Time | Operator and narration |
| --- | --- |
| 0:00–0:20 | Show the four-stop paper. “Students can predict what a network does, then change it with a pen.” Upload/capture and Read paper map. |
| 0:20–0:40 | Confirm labels and roads, Start deliveries, pause early. “The model reads; code routes and moves two real packages.” |
| 0:40–1:05 | Show red X on junction–home. Rescan/confirm; step until home courier waits. Click courier. “The same package waits because its destination is disconnected.” |
| 1:05–1:30 | Add shop–home; rescan/confirm; Resume. Show NEW road and alternate route, then same package completion. |
| 1:30–1:50 | Dictate or type “Send an urgent delivery from Depot to Shop.” Review and confirm. “Jev handles narrow intent; Codex handles compounds, with code validation.” |
| 1:50–2:00 | “This is a teaching demo, not classroom-validated yet. Physical device support and recognition need rehearsal.” Show evidence/cost notes. |

If inference takes longer, rehearse the timings and use the backup recording explicitly labeled with its evidence source. Never imply replayed model output was a live request. If dictation fails, show its retained transcript/error, then type the instruction; do not pretend the voice path succeeded.

## Five-minute novice test

Ask an educator or unfamiliar person: “Scan this drawing, start deliveries, make one delivery wait, restore it by adding a connection, and send one urgent delivery.” Give no button instructions initially. Record device/browser, time to first delivery, misclicks, where help was needed, whether they predicted the closure, and whether they could identify the same recovered package. Ask “What confused you?” and “How would you use this to teach a network?” Save actual verbatim feedback with consent; no participant or result is currently claimed.

## Operator reserve

Stop implementation 90 minutes before the actual submission deadline. Rehearse twice, confirm localhost provider readiness, test the physical paper/camera/mic, check backup playback and submission attachments. User supplied8pm Pacific on2026-10-11; reserve6:30-8pm local for rehearsal/submission. User said PST; using local Pacific clock conservatively unless organizer specifies fixed UTC-8. Preserve .env; do not publish it, credentials, or private paper photos.
