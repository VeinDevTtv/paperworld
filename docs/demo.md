# Rehearse the Paperworld demo

## Prepare

For production rehearsal: `npm run build`, then `npm run start` from the project folder. Open http://127.0.0.1:3000. Stop any existing server on that port first. Preserve your existing `.env`. Development remains `npm run dev`; both bind only to loopback. Do not run two servers on the same port.

Start `npm run dev` and open http://127.0.0.1:3000. Keep the existing local `.env`. The labeled sample starts paused. For a repeatable raster rehearsal, use `/demo/initial.png`, `/demo/blocked.png`, and `/demo/reconnected.png`; save those files and upload them in that order. For the real paper demo, use your own drawing and camera or upload.

## Draw → scan → confirm

Draw four clearly labeled stops with stable IDs: DEPOT D, JUNCTION J, HOME H, and SHOP S. Connect D–J, J–H, and J–S. Do not connect S–H yet. Choose **Upload photo** or **Use camera** → **Capture frame**, then **Read paper map**. Review the proposal and choose **Confirm map**. Correct any transcription before confirming.

Choose **Start deliveries**. This creates clearly labeled demo packages from the scanned map and dispatches two couriers; no manual package setup is needed. Playback begins at 0.25× demo speed. Choose **Pause** after about four real seconds, before the home delivery completes. Open **Playback controls** and use **Step 1 second** when you need a precise moment.

## Change the paper → rescan → recover

Mark the J–H road with a red X. Keep all stop IDs unchanged. Upload or capture the revised drawing, choose **Read paper map**, and choose **Confirm changes** after reviewing the closure. The same couriers and packages keep their positions and progress. Playback stays paused. Step until the courier reaches the junction: a courier already on a road finishes that segment; the unreachable home delivery then waits. Click that courier to see its package, destination, and waiting reason.

Before recovery, enter **Set package pkg-1 to urgent** using the actual package ID displayed in your run. Choose **Review command**, check the proposal, then **Confirm and apply**. The app chooses the supported provider category automatically and shows actual request latency.

Draw a new S–H road while leaving J–H closed. Upload, choose **Read paper map**, and **Confirm changes**. Watch the changed road and replacement route. Optionally set **Playback controls** → **Speed** → **1×**, then choose **Resume**. Changing speed alone does not resume playback. The same stranded package must reach home physically and complete once. Open **Run details** for package IDs and completion events.

## Voice/text instruction

Dictation shows starting → listening → processing → stopped, or an error. Speak only when Listening appears. Network failure may come from your browser's speech service. A physical Brave test repeatedly failed; try the localhost page in Google Chrome, allow microphone access, then retest. On Windows you can focus the command field and use Win+H; this is OS dictation, not a passed Paperworld Web Speech test. Any captured text stays editable; Retry dictation or type it. Microphone denial requires allowing access in browser site settings. Voice never applies actions automatically. If Jev command review fails, Retry uses the current world; Use Codex explicitly requests the subscription provider and still requires confirmation.

Enter **Send an urgent delivery from Depot to Shop**, using the actual visible stop names. One reviewed request creates and dispatches a delivery; code allocates its package ID and checks courier capacity. A compound instruction uses Codex; a supported narrow operation uses Jev. No difficulty guess controls routing.

If voice is supported, choose **Dictate**, speak the same instruction, edit the transcript, and choose **Review command** deliberately. Try **Send a delivery from Depot** to demonstrate clarification for the missing destination without a state change. To rehearse again on the confirmed map, choose **Playback controls** → **Reset run**, then **Start deliveries**. Restore the initial road layout first if you want the same closure sequence.

Manual dispatch, provider diagnostics, history, and detailed map editing are available in secondary panels. They are useful recovery tools, not required demo setup.

## What the rehearsal proves

Large supported photos are compressed locally before scanning; check that labels are upright/readable in the preview. For reproducible rotated-photo tests run `npx tsx scripts/photo-fixtures.ts` and upload the JPEGs from `.local/photo-fixtures` in initial/blocked/recovered order. These are synthetic images. A new-home variant adds N connected to Shop; review all road changes. For physical camera repositioning, move the camera while preserving stop IDs, rescan, and verify existing package IDs/positions/progress remain unchanged. Report failures rather than correcting the evidence after the fact.

Generated PNG rehearsal tests real image inference, reviewed map updates, deterministic movement, command validation, and the recovery loop. It does not establish arbitrary handwriting recognition or physical camera operation. User separately reported a handwritten recovery loop and supplied physical dictation/dispatch/completion screenshots. Browser/device coverage still needs rehearsal. See [current verification](release-verification.md) for performed checks and remaining limits.

## Backup clip

Local fallback: `.local/evidence/paperworld-backup-synthetic-live.mp4` (66 seconds, no audio). It is visibly labeled synthetic-photo demo with live Codex/Jev. It shows the closure, priority update, added connection and same package completion. Some frames are soft; record your physical two-minute rehearsal for submission when possible. Play this clip before rehearsal to verify the file on your device. Do not describe it as physical-camera footage or a live request when replaying it.
