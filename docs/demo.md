# Three-minute demo

1. Start `npm run dev`, open http://127.0.0.1:3000 and pause the labeled sample. Inspect a courier, then create and assign a delivery manually to see physical movement.
2. Draw a fresh map with clearly named DEPOT, JUNCTION, HOME and SHOP stops, each with a stable letter ID. Join the depot to the junction, then join the junction to home and shop. Upload the photo, choose **Read paper map**, correct the proposal, and choose **Apply & start this world**.
3. Create a delivery from the depot to home and assign it to a courier. Play briefly, then pause while the courier is on the depot–junction road.
4. Mark the junction–home road with a red X. Upload the revised drawing and rescan. Check the proposed closure before applying. The courier must keep its position, finish its current segment, and report an unreachable destination.
5. Draw a new shop–home road, keeping every location ID unchanged. Upload, rescan and apply. The same delivery resumes via the shop and completes only after physical arrival at home.
6. Before it finishes, make that package urgent using the manual priority control or text `Set package pkg-1 to urgent`. Review and apply the model proposal. Show the measured model latency and priority-change event.
7. In compound mode, request a priority change and road closure together using the visible package/road IDs. Review the constrained command list. Try an ambiguous target to demonstrate clarification without a state change.

Pause/step/speed controls let you make every transition visible. Voice is optional: dictate, edit the transcript, then submit it deliberately. Browser/device permissions may require manual approval.

The reproducible fresh raster drawing acceptance and its precise results are recorded in [acceptance evidence](acceptance.md). A successful synthetic drawing test does not prove physical webcam capture or voice transcription on every device.
