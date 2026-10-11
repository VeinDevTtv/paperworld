# Paired command benchmark

Run `npx tsx scripts/benchmark.ts --live` from the repository, preserving `.env`. Uses existing Jev and subscription Codex. The harness explicitly disables the paid adapter in its process. Optional `PAPERWORLD_BENCHMARK_REPEATS=2` repeats every pair; default is one. No automatic retries are enabled. Each attempt, including errors, stays in the denominator. Wall time includes routing, parsing, validation and local process overhead; it excludes human confirmation.

Twelve frozen requests cover simple, compound, ambiguous, invalid and three held-out paraphrases. Every mode starts with the same map/couriers/package. Call order alternates. Both use the same production typed validation and `applyCommands`; command cases must match the **entire** expected final state, including events, with no extra effects. Clarification cases must return no commands. Raw records save request, initial/resulting state, proposal, provider/model, available usage, attempts/retries, latency and failures.

## 2026-10-11 outcomes

Separate isolated diagnostics reported 2/12 rapid failures with the original schema, then 7/8 valid proposals after the fix with one genuine 75,066 ms timeout. These probes are outside the paired sample and do not enlarge its denominator or quality claims.

| Run | Auto | Codex-only | Notes |
| --- | --- | --- | --- |
| 19:22 diagnostic | 10/12 | 9/12 | Five provider failures; preliminary effect predicates were weaker and later corrected. Do not use this run for quality comparison. |
| 19:24 exact-state | 11/12 | 8/12 | Five provider failures, no semantic failure among returned responses. |
| 19:30 after schema fix | 12/12 | 12/12 | All exact-state or clarification criteria passed; 24 total calls, one repetition. |

Final-run automatic median wall time: **141 ms**, mean **1,227 ms**. Codex-only median: **4,961 ms**, mean **5,787 ms**. Clarification: **5/12 (41.7%)** in each mode; these were intentionally ambiguous/invalid cases. Auto delegated three requests to Codex. Narrow Jev responses reported `jev-1.13.0`; Codex model IDs were **not reported**. Jev usage is recorded for all 12 router calls (nine direct responses plus three delegated receipts); Codex token usage is **not reported**. Missing usage is never treated as zero.

This is a small local convenience sample, not a statistical or general speedup claim. No provider retry latency is measured because no retry occurred. Earlier failures cannot be erased by the passing run. Account/network load and process startup vary. The initial failures reproduced as intermittent HTTP400 structured-output rejection; explicitly typing command discriminators in the JSON schema removed those rapid failures in the next paired run. Slow requests and future provider failures remain possible; Retry/Use Codex stays visible and state remains unchanged until confirmation.

Raw JSON: [diagnostic](evidence/benchmark-2026-10-11T19-22-29-015Z.json), [exact-state pre-fix](evidence/benchmark-2026-10-11T19-24-21-558Z.json), [post-fix](evidence/benchmark-2026-10-11T19-30-03-594Z.json). No paid API calls or physical speech/image inputs are part of this benchmark. See [cost assumptions](submission.md).
