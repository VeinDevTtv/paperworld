# Provider smoke evidence

Captured October 11, 2026. These checks use a generated synthetic map image and a fixed, non-sensitive command prompt.

## Image to map schema

The local Codex CLI interpreted an SVG-rendered PNG and returned a map object that passed the smoke script's Zod validation. It identified four locations, three roads, and the marked closed road (`J-C`). The PNG was 28,375 bytes. The latest Codex request completed in 7,062 ms.

The CLI used its saved ChatGPT sign-in, with read-only sandboxing and an isolated temporary working directory. Shell execution, unified exec, patch application, and web search were disabled. The request attached local image bytes; it did not fetch an image URL. The event stream contained no tool request. The temporary image and result files were removed after the check.

## Typed decision

One real TypeSafe HTTP request classified the text “Set package pkg-1 to urgent.” It returned `set_priority` and `urgent` with confidence 1.0, in 207 ms. The response reported 508 input tokens and 97 output tokens. The smoke uses this as a bounded command classification result; confidence is not treated as evidence that a command is valid or safe to apply.

TypeSafe's documented endpoint accepts JSON `state`, a model name such as `jev-latest`, and named typed questions. A choice question defines its allowed labels in `criteria`; its answer includes a selected label, probabilities, and confidence. The API documentation describes text and structured JSON state, not image input, so image interpretation happens before a TypeSafe decision.

## Official references

- [TypeSafe HTTP API reference](https://docs.typesafe.ai/api)
- [TypeSafe JavaScript SDK](https://docs.typesafe.ai/sdk/javascript)
- [OpenAI Codex CLI reference](https://developers.openai.com/codex/cli/reference)
- [OpenAI Structured Outputs](https://developers.openai.com/api/docs/guides/structured-outputs?api-mode=responses)
- [OpenAI image and vision inputs](https://developers.openai.com/api/docs/guides/images-vision?api-mode=responses)

The optional OpenAI API adapter is not enabled by this smoke. Its use must remain an explicit configuration choice; Codex CLI failure does not trigger an API-key request or paid fallback.
