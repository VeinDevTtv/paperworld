# Provider and simulation acceptance

Run npm run acceptance to generate and parse three map drawings, exercise the simulator across a road closure and recovery, and request/apply provider command proposals. The harness saves its generated PNG fixtures to public/demo as it runs:

- [Initial map](../public/demo/initial.png): depot, junction, home, shop, and three open roads.
- [Blocked map](../public/demo/blocked.png): the same map with the junction-to-home road marked closed by a red X.
- [Reconnected map](../public/demo/reconnected.png): the blocked map plus an open shop-to-home road.

The run requires a ready local Codex sign-in and JEv credentials. It fails closed if paid OpenAI API mode is enabled. Provider calls are real; generated drawings and report metadata contain no user-uploaded map.

## Latest acceptance run

Run date: 2026-10-11. Result: passed.

| Stage | Provider/model | Raster size | Latency | Parsed graph |
| --- | --- | ---: | ---: | --- |
| Initial | Codex / codex-chatgpt | 36,831 bytes | 7,421 ms | 4 locations, 3 roads |
| Blocked | Codex / codex-chatgpt | 37,265 bytes | 7,351 ms | 4 locations, 3 roads |
| Reconnected | Codex / codex-chatgpt | 41,132 bytes | 7,664 ms | 4 locations, 4 roads |

All scans required human review as expected for image interpretation, and the reconciliation pass returned no review reasons. The acceptance checked stable location IDs and coordinates across scans, preserved road identity on the closure, and detected the new shop-to-home edge.

The simulation created and assigned pkg-1 from the depot to the home. The courier picked it up while physically at the depot, then advanced 40% of the depot-to-junction segment. Applying the blocked scan retained the exact segment and interpolated position (23.128, 54.69), marked the package unreachable, and preserved the map IDs and coordinates. The courier reached the junction and stranded with no open next segment; the run observed exactly one pickup event.

JEv (jev-1.13.0) proposed urgent priority for pkg-1 in 250 ms; the proposal was applied. After the third scan added the shop-to-home road, the package resumed as in transit and was physically delivered. The simulation completed in 13.617 seconds with 133.965 distance traveled, and recorded exactly one delivery event.

An ambiguous JEv request with two existing packages returned a clarification in 149 ms, with no commands applied. Local Codex (codex-chatgpt) handled mode openai while paid API mode was disabled: with two existing packages and a valid road, it returned set-priority and set-road commands in 5,137 ms. Both commands passed validation and were applied to a scratch simulation.

The fixtures are clean, generated raster maps. This run verifies the parser and workflow with these drawings; it does not establish webcam capture, user-upload behavior, or recognition of arbitrary handwriting.
