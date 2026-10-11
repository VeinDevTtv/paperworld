# Polished demo verification

This pass simplifies the default workspace and verifies the delivery workflow through the UI as well as the deterministic core. Provider calls use the existing local Codex subscription and TypeSafe configuration; the paid OpenAI adapter stays disabled.

## Scope

- A paused, explicitly labeled sample; a large world beside a compact drawing preview.
- One visible command bar; progressive disclosure for manual dispatch, editing, diagnostics, and history.
- Two labeled demo deliveries generated from the confirmed map, with reset and restart support.
- Manual road and package controls that work without inference.
- Reviewed proposals that cannot silently cross a reset or changed world.
- Editable map identity correction, physical movement, and visible active deliveries.

## Verification

On UI PR #7 head `d9d2c5c`, a continuous browser run used a fresh alternate generated drawing, not the shipped sample: DEPOT LARCH, JUNCTION CENTRAL, HOME WILLOW, and SHOP MARKET. It first changed a sample road, then verified that the first confirmed scan replaced that sample with an empty scanned world. Start deliveries created two DEMO packages and dispatched Mina and Rook from the actual scanned depot.

| Request | Provider | Measured latency | Result |
| --- | --- | ---: | --- |
| Initial drawing | Local Codex | 8,698 ms | 4 stops, 3 roads |
| Red-X closure | Local Codex | 7,124 ms | Same stops and roads; home road closed |
| New connection | Local Codex | 7,797 ms | Same stops, 4 roads; shop-home connection added |
| Priority | Jev / TypeSafe | 170 ms | Existing pkg-1 became urgent |
| Create and dispatch | Jev / TypeSafe | 132 ms | Code allocated pkg-3 and assigned a courier |
| Compound priority and closure | Jev to local Codex | 5,394 ms total | Two validated changes; category routing took 110 ms |
| Missing destination | Jev / TypeSafe | 110 ms | Clarification, no commands or new package |

Both rescans preserved courier SVG transforms exactly. The closure preserved both at `translate(251.64836035515478 196.2089499466604)`. Mina finished the occupied road and waited at the junction with pkg-1 and its destination/waiting reason visible. Recovery preserved Mina at `translate(445 294.5232)` and Rook at `translate(513.663585897961 319.4736365721779)`. The replacement route was highlighted; the same urgent pkg-1 physically reached home at simulation second 15 with one completion event. Pkg-2 completed at second 8. No package setup or reassignment was needed between scans.

Independent browser regressions verified scanned reset to empty state then restart with exactly two DEMO packages, no duplicate Start after dispatch, stale and delayed command proposals discarded on reset, all nine active/queued package rows accessible, manual road toggles preserving positions, straight road geometry, physical courier interpolation, and an in-flight removed-road trail. Editing a proposed stop ID updates connected endpoints together. Desktop 1440px and mobile 390px layouts were inspected through DOM interaction; mobile had no horizontal overflow.

The first UI review found and fixed a race that replaced the scanned proposal with the sample when the review panel opened. A later review found an open map editor could restore a road changed by a command; the final iteration invalidates those stale map reviews.

On final UI head `33ea668`, the complete loop was replayed using the same fresh PNGs and recorded real parsed-map responses, with inference mocked for this regression. Closure showed one CHANGED road; recovery showed one NEW road and two alternate route lines. Both position comparisons were exact, the same urgent pkg-1 completed once, and twelve simulation steps caused no provider calls. These replayed receipts retain original live latency values; they are not additional live latency measurements.

The independent final review verified changed-road badges and their clearing/refresh behavior, accepted road commands invalidating open map reviews, an in-flight scan aborted after a road command with no late confirmation, pinned sample references, visible speech errors, and distinct per-ID controls for parallel roads. Logic PR #6 and UI PR #7 received analytical review, fixes, and head-specific approval before merging. Final integrated checks follow below.

### Integrated release checks

After merging into main, all 41 automated tests passed, `npm run typecheck` passed, and the standard `npm run build` completed under Next.js 16.4.0/Turbopack. `npm run check:secrets` passed; a separate exact-value check found no loaded credentials in the 11 built browser assets. The production dependency audit reported zero known vulnerabilities; no dependencies changed in this polish pass.

The production server returned HTTP 200 and listened only on 127.0.0.1:3000. Browser readiness reported Codex image/compound and Jev ready, with the paid adapter disabled. All secondary panels started closed. At 1440×900, the main command bar ended within the viewport and there was no horizontal overflow. The 390px production layout also had no horizontal overflow and kept the world, command bar, and paper controls in that order. The browser was returned to the paused sample for rehearsal.

## Device limits

Physical webcam capture and microphone transcription require testing on the user's device. Generated raster drawings exercise real image inference but cannot establish recognition of arbitrary handwriting. A mocked speech-recognition result populated the editable command transcript and made no provider call until Review command; that proves transcript wiring, not microphone transcription. A synthetic canvas camera stream destabilized the browser host, while the app server continued returning HTTP 200, so camera capture is not counted as passed. The optional paid API adapter remains untested and disabled. Host snapshots failed; browser DOM inspection and interactive workflows remained available.

Parallel roads share the same straight rendered centerline so movement stays physically consistent. To edit either by its own ID, use Adjust map → Roads; overlapping paths are less convenient to select directly in the world. Uploads support PNG, JPEG, or WebP up to 1.5 MB; larger phone photos need resizing before upload.

### Independent alternate drawing run

Before integrating the polish, a separate fresh raster drawing set used labels DEPOT LARCH, JUNCTION CENTRAL, HOME WILLOW, and SHOP MARKET, with different node geometry from the shipped demo fixtures. All three real Codex scans passed: 8,836 ms / 8,092 ms / 8,217 ms and 4 stops with 3 / 3 / 4 roads. The same package preserved physical position (26.248, 36.252) during closure, became unreachable, resumed through the new road, and delivered after 142.109 distance units. Jev priority took 231 ms; ambiguity returned clarification in 137 ms; the Codex compound proposal took 4,517 ms. Paid API mode remained disabled. This was generated raster input, not a physical photograph.
