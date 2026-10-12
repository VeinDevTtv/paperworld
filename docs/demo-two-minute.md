# Two-minute Paperworld demo

Run the production build on the presentation laptop: `npm ci`, `npm run build`, then `npm start`. Preserve `.env`, sign in to the local Codex CLI, and verify TypeSafe readiness before presenting. Keep a clearly labeled backup recording available. Do not expose the local server publicly.

Prepare a legible paper map: Depot, Junction, Home, Shop; roads Depot–Junction, Junction–Home, Junction–Shop. Keep labels and camera framing consistent across captures. Use the actual labels and package ID shown by the app.

| Target | Action and narration |
| --- | --- |
| 0:00–0:20 | Show the real paper. **Upload & scan** or **Use camera → Capture & scan**, inspect the proposed map, then **Confirm map**. “Paperworld turns a sketch into a network students can experiment with.” Let the confirmed 3D buildings appear. |
| 0:20–0:35 | **Start deliveries**, then pause early, before the home courier enters Junction–Home. Identify its package. “AI reads the drawing; code tracks real routes, packages and deliveries.” |
| 0:35–1:00 | A judge marks Junction–Home with a red X. Capture/scan, confirm, and step until the courier waits at Junction. Click it to show the same package and its waiting reason. “The destination is now disconnected.” |
| 1:00–1:25 | Draw Shop–Home without reopening Junction–Home. Capture/scan and confirm. Show the new connection, resume at 1×, and let the same package complete. “One line on paper restored this delivery.” |
| 1:25–1:40 | Open **Compare road change → Compare latest road change**. Toggle **Without change / With change** and read the actual takeaway. “Both simulations start from the same saved state and run for the same 20 seconds. Here is what the new connection changed.” This is a read-only simulated outcome, not a real-world prediction. |
| 1:40–2:00 | **Return to live world**. Dictate or type “Send an urgent delivery from Depot to Shop,” review and confirm. Show the measured provider receipt. “Jev handles narrow commands; Codex interprets drawings and compound requests. No model runs on every animation frame.” |

These are rehearsal targets, not promises about inference or handwriting latency. If the allotted presentation is shorter, omit the final extra dispatch rather than skipping map confirmation or hiding failed requests. The comparison is a calculated endpoint preview, not a replay of the live delivery.

## Recovery

If speech fails, retain/edit the transcript or type. If Jev fails, choose **Retry** or explicitly **Use Codex**; no paid fallback is automatic. If WebGL fails, continue the same run in the 2D view under the secondary view controls. Start the final recording from a clean state without regression-test alerts. Clearly label synthetic inputs, mocked responses, or backup playback; do not describe them as live physical evidence.

## Evidence boundaries

Automated browser checks use synthetic maps and mocked provider responses. Prior live-model runs and user-reported physical checks are documented separately. Final hardware rehearsal and submission are operator actions. Human classroom effectiveness is not established, and the optional paid adapter remains disabled until separately authorized and tested.
