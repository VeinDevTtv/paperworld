import { spawn } from "node:child_process";
import { accessSync, constants as fsConstants } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { z } from "zod";
import {
  commandSchema,
  commandsSchema,
  courierSchema,
  packageSchema,
  paperMapSchema,
  type Command,
  type Courier,
  type Package,
  type PaperMap,
} from "../lib/schema";
import { ApiError } from "./security";

const IMAGE_LIMITS = { "image/png": 1_500_000, "image/jpeg": 1_500_000, "image/webp": 1_500_000 } as const;
const CODEX_TIMEOUT_MS = 75_000;
const TYPE_SAFE_TIMEOUT_MS = 12_000;
const OPENAI_TIMEOUT_MS = 25_000;
const MAX_PROVIDER_OUTPUT_BYTES = 64_000;
const COMMAND_MODES = ["jev", "openai"] as const;

const commandRequestSchema = z.object({
  text: z.string().trim().min(1).max(2_000),
  map: paperMapSchema,
  packages: z.array(packageSchema).max(256),
  couriers: z.array(courierSchema).max(16),
  mode: z.enum(COMMAND_MODES),
}).strict();

const commandProposalSchema = z.object({
  commands: commandsSchema,
  clarification: z.string().trim().max(400).nullable(),
}).strict();

const typeSafeResponseSchema = z.object({
  model: z.string().max(80),
  answers: z.record(z.string(), z.object({
    type: z.literal("choice"),
    choice: z.string().max(80),
    probabilities: z.record(z.string(), z.number().min(0).max(1)).optional(),
    confidence: z.number().min(0).max(1),
  })),
  usage: z.object({
    input_tokens: z.number().int().nonnegative(),
    output_tokens: z.number().int().nonnegative(),
  }).optional(),
});

type ImageMime = keyof typeof IMAGE_LIMITS;
type ProviderName = "codex" | "typesafe" | "openai";

export type MapParseResult = {
  map: PaperMap;
  provider: "codex" | "openai";
  model?: string;
  latencyMs: number;
  requiresReview: true;
  reviewReasons: string[];
};

export type CommandProposal = {
  commands: Command[];
  clarification: string | null;
  provider: "typesafe" | "codex" | "openai";
  model: string;
  latencyMs: number;
};

export type ProviderStatus = {
  image: { provider: "codex" | "openai"; ready: boolean; model: string; detail: string };
  command: { provider: "codex" | "openai"; ready: boolean; model: string; detail: string };
  jev: { ready: boolean; model: string };
  openaiApi: { enabled: boolean; ready: boolean; model: string };
};

const locationSchemaForCodex = {
  type: "object", additionalProperties: false,
  properties: {
    locations: { type: "array", minItems: 1, maxItems: 32, items: {
      type: "object", additionalProperties: false,
      properties: {
        id: { type: "string", minLength: 1, maxLength: 24 },
        label: { type: "string", minLength: 1, maxLength: 80 },
        kind: { type: "string", enum: ["depot", "home", "shop", "junction"] },
        x: { type: "number", minimum: 0, maximum: 100 },
        y: { type: "number", minimum: 0, maximum: 100 },
      }, required: ["id", "label", "kind", "x", "y"],
    } },
    roads: { type: "array", maxItems: 64, items: {
      type: "object", additionalProperties: false,
      properties: {
        id: { type: "string", minLength: 1, maxLength: 24 },
        from: { type: "string", minLength: 1, maxLength: 24 },
        to: { type: "string", minLength: 1, maxLength: 24 },
        closed: { type: "boolean" },
      }, required: ["id", "from", "to", "closed"],
    } },
  }, required: ["locations", "roads"],
} as const;

const commandProposalJsonSchema = {
  type: "object", additionalProperties: false,
  properties: {
    commands: { type: "array", maxItems: 64, items: { anyOf: [
      { type: "object", additionalProperties: false, properties: { type: { const: "create-package" }, from: { type: "string" }, to: { type: "string" }, priority: { type: "string", enum: ["normal", "urgent"] } }, required: ["type", "from", "to", "priority"] },
      { type: "object", additionalProperties: false, properties: { type: { const: "set-priority" }, packageId: { type: "string" }, priority: { type: "string", enum: ["normal", "urgent"] } }, required: ["type", "packageId", "priority"] },
      { type: "object", additionalProperties: false, properties: { type: { const: "set-road" }, roadId: { type: "string" }, closed: { type: "boolean" } }, required: ["type", "roadId", "closed"] },
      { type: "object", additionalProperties: false, properties: { type: { const: "assign-package" }, packageId: { type: "string" }, courierId: { type: "string" } }, required: ["type", "packageId", "courierId"] },
    ] } },
    clarification: { anyOf: [{ type: "string", maxLength: 400 }, { type: "null" }] },
  }, required: ["commands", "clarification"],
} as const;

function apiEnabled(): boolean {
  return process.env.PAPERWORLD_OPENAI_PROVIDER === "api" && process.env.PAPERWORLD_ALLOW_PAID_API === "true";
}

function openAiModel(): string {
  return process.env.OPENAI_MODEL?.trim() || "";
}

function typeSafeModel(): string {
  return process.env.TYPESAFE_MODEL?.trim() || "jev-latest";
}

function createCodexEnvironment(): NodeJS.ProcessEnv {
  const safe: NodeJS.ProcessEnv = { NODE_ENV: "production" };
  const names = ["PATH", "Path", "SystemRoot", "WINDIR", "USERPROFILE", "HOMEDRIVE", "HOMEPATH", "APPDATA", "LOCALAPPDATA", "TEMP", "TMP", "CODEX_HOME", "npm_config_prefix", "LANG", "LC_ALL"];
  for (const name of names) if (process.env[name]) safe[name] = process.env[name];
  for (const name of ["OPENAI_API_KEY", "TYPESAFE_API_KEY", "CODEX_API_KEY", "CODEX_ACCESS_TOKEN"]) delete safe[name];
  return safe;
}

type CodexLauncher = { command: string; prefixArgs: string[] };

function findCodexLauncher(environment: NodeJS.ProcessEnv): CodexLauncher {
  const roots = [
    environment.APPDATA ? path.join(environment.APPDATA, "npm", "node_modules") : "",
    environment.npm_config_prefix ? path.join(environment.npm_config_prefix, "node_modules") : "",
    environment.npm_config_prefix ? path.join(environment.npm_config_prefix, "lib", "node_modules") : "",
    path.join(os.homedir(), ".npm-global", "lib", "node_modules"),
  ].filter(Boolean);
  const platformPackage = process.platform === "win32" ? (process.arch === "arm64" ? "codex-win32-arm64" : "codex-win32-x64")
    : process.platform === "linux" ? (process.arch === "arm64" ? "codex-linux-arm64" : "codex-linux-x64")
      : process.platform === "darwin" ? (process.arch === "arm64" ? "codex-darwin-arm64" : "codex-darwin-x64") : "";
  const triple = process.platform === "win32" ? (process.arch === "arm64" ? "aarch64-pc-windows-msvc" : "x86_64-pc-windows-msvc")
    : process.platform === "linux" ? (process.arch === "arm64" ? "aarch64-unknown-linux-musl" : "x86_64-unknown-linux-musl")
      : process.platform === "darwin" ? (process.arch === "arm64" ? "aarch64-apple-darwin" : "x86_64-apple-darwin") : "";

  for (const root of roots) {
    const packageRoot = path.join(root, "@openai", "codex");
    const nativeCandidates = platformPackage ? [
      path.join(packageRoot, "node_modules", "@openai", platformPackage, "vendor", triple, "bin", process.platform === "win32" ? "codex.exe" : "codex"),
      path.join(root, "@openai", platformPackage, "vendor", triple, "bin", process.platform === "win32" ? "codex.exe" : "codex"),
    ] : [];
    for (const candidate of nativeCandidates) {
      try {
        accessSync(candidate, fsConstants.X_OK);
        return { command: candidate, prefixArgs: [] };
      } catch { /* Try the next native install layout. */ }
    }
  }

  // Windows npm shims spawn a second Node process; killing the shim can leave
  // the Codex child running. Fail closed there unless the native binary exists.
  if (process.platform === "win32") throw new ApiError(503, "codex_native_unavailable");

  const entries = (environment.PATH ?? environment.Path ?? "").split(path.delimiter).filter(Boolean);
  for (const entry of entries) {
    const candidate = path.join(entry, "codex");
    try {
      accessSync(candidate, fsConstants.X_OK);
      return { command: candidate, prefixArgs: [] };
    } catch { /* Keep looking through PATH without exposing it. */ }
  }
  throw new ApiError(503, "codex_unavailable");
}

function containsToolRequest(value: unknown): boolean {
  const blocked = new Set(["command_execution", "local_shell_call", "shell_call", "mcp_tool_call", "web_search_call", "computer_call", "function_call", "file_change", "apply_patch"]);
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  if (typeof record.type === "string" && blocked.has(record.type)) return true;
  for (const nested of Object.values(record)) if (Array.isArray(nested) ? nested.some(containsToolRequest) : containsToolRequest(nested)) return true;
  return false;
}

async function runCodexJson(options: { prompt: string; schema: unknown; image?: Buffer; timeoutMs?: number }): Promise<{ value: unknown; model: string; latencyMs: number }> {
  const environment = createCodexEnvironment();
  const launcher = findCodexLauncher(environment);
  const directory = await mkdtemp(path.join(os.tmpdir(), "paperworld-codex-"));
  const schemaPath = path.join(directory, "output.schema.json");
  const outputPath = path.join(directory, "output.json");
  const imagePath = options.image ? path.join(directory, "input-image.bin") : undefined;
  try {
    await writeFile(schemaPath, JSON.stringify(options.schema));
    if (options.image && imagePath) await writeFile(imagePath, options.image);
    const args = ["exec", "--ephemeral", "--ignore-user-config", "--ignore-rules", "--skip-git-repo-check", "--sandbox", "read-only",
      "-c", "features.shell_tool=false", "-c", "features.unified_exec=false", "-c", "features.apply_patch_freeform=false", "-c", 'web_search="disabled"', "-c", 'forced_login_method="chatgpt"', "--json", "--cd", directory];
    if (imagePath) args.push("--image", imagePath);
    args.push("--output-schema", schemaPath, "--output-last-message", outputPath, "-");
    const started = performance.now();
    const model = await new Promise<string>((resolve, reject) => {
      const child = spawn(launcher.command, [...launcher.prefixArgs, ...args], { cwd: directory, env: environment, shell: false, windowsHide: true, detached: process.platform !== "win32", stdio: ["pipe", "pipe", "pipe"] });
      let stdoutBytes = 0; let stderrBytes = 0; let forcedError: ApiError | undefined; let settled = false;
      const stdout: Buffer[] = []; const stderr: Buffer[] = [];
      const terminate = () => {
        try {
          if (process.platform !== "win32" && child.pid) process.kill(-child.pid, "SIGKILL");
          else child.kill();
        } catch { child.kill(); }
      };
      const timer = setTimeout(() => { forcedError = new ApiError(504, "provider_timeout"); terminate(); }, options.timeoutMs ?? CODEX_TIMEOUT_MS);
      const finish = (error?: Error, result?: string) => {
        if (settled) return; settled = true; clearTimeout(timer);
        if (error) reject(error); else resolve(result ?? "");
      };
      child.stdout.on("data", (chunk: Buffer) => {
        stdoutBytes += chunk.length;
        if (stdoutBytes > MAX_PROVIDER_OUTPUT_BYTES) { forcedError = new ApiError(502, "provider_output_too_large"); terminate(); }
        else stdout.push(chunk);
      });
      child.stderr.on("data", (chunk: Buffer) => {
        stderrBytes += chunk.length;
        if (stderrBytes > MAX_PROVIDER_OUTPUT_BYTES) { forcedError = new ApiError(502, "provider_output_too_large"); terminate(); }
        else stderr.push(chunk);
      });
      child.once("error", () => finish(new ApiError(503, "codex_unavailable")));
      child.once("close", (code) => {
        if (forcedError) { finish(forcedError); return; }
        if (code !== 0) { finish(new ApiError(502, "provider_failed")); return; }
        let selectedModel = "codex-chatgpt";
        for (const line of Buffer.concat(stdout).toString("utf8").split(/\r?\n/)) {
          if (!line) continue;
          let event: unknown;
          try { event = JSON.parse(line); } catch { finish(new ApiError(502, "provider_invalid_output")); return; }
          if (containsToolRequest(event)) { finish(new ApiError(502, "provider_tool_request_rejected")); return; }
          if (event && typeof event === "object") {
            const modelName = (event as Record<string, unknown>).model;
            if (typeof modelName === "string" && modelName.length <= 80) selectedModel = modelName;
          }
        }
        finish(undefined, selectedModel);
      });
      child.stdin.end(options.prompt);
    });
    let output: Buffer;
    try { output = await readFile(outputPath); } catch { throw new ApiError(502, "provider_invalid_output"); }
    if (output.byteLength > MAX_PROVIDER_OUTPUT_BYTES) throw new ApiError(502, "provider_output_too_large");
    let value: unknown;
    try { value = JSON.parse(output.toString("utf8")) as unknown; } catch { throw new ApiError(502, "provider_invalid_output"); }
    return { value, model, latencyMs: Math.round(performance.now() - started) };
  } finally {
    await rm(directory, { recursive: true, force: true }).catch(() => undefined);
  }
}

function validateImage(image: string): { mime: ImageMime; bytes: Buffer } {
  const match = /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/]*={0,2})$/.exec(image);
  if (!match) throw new ApiError(400, "unsupported_image");
  const mime = match[1] as ImageMime;
  const encoded = match[2];
  if (encoded.length % 4 !== 0) throw new ApiError(400, "invalid_image");
  const bytes = Buffer.from(encoded, "base64");
  if (bytes.byteLength === 0 || bytes.byteLength > IMAGE_LIMITS[mime] || bytes.toString("base64") !== encoded) throw new ApiError(413, "image_too_large_or_invalid");
  const isPng = mime === "image/png" && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  const isJpeg = mime === "image/jpeg" && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[bytes.length - 2] === 0xff && bytes[bytes.length - 1] === 0xd9;
  const isWebp = mime === "image/webp" && bytes.subarray(0, 4).toString("ascii") === "RIFF" && bytes.subarray(8, 12).toString("ascii") === "WEBP";
  if (!isPng && !isJpeg && !isWebp) throw new ApiError(400, "invalid_image");
  return { mime, bytes };
}

function normalizedLabel(value: string): string { return value.trim().toLocaleLowerCase("en-US").replace(/\s+/g, " "); }
function edgeKey(from: string, to: string): string { return [from, to].sort().join("\u0000"); }
function unusedId(prefix: string, used: Set<string>): string {
  let index = 1;
  while (used.has(`${prefix}${index}`)) index += 1;
  return `${prefix}${index}`;
}

function reconcileMap(candidate: PaperMap, previous?: PaperMap): { map: PaperMap; reviewReasons: string[] } {
  const reviewReasons: string[] = [];
  const oldLocations = previous?.locations ?? [];
  const oldRoads = previous?.roads ?? [];
  const usedLocationIds = new Set<string>();
  const reservedLocationIds = new Set(oldLocations.map((location) => location.id));
  const candidateToStable = new Map<string, string>();
  const matchedOldLocations = new Set<string>();

  const locations = candidate.locations.map((location) => {
    const byId = oldLocations.filter((old) => old.id === location.id && old.kind === location.kind && !matchedOldLocations.has(old.id));
    const byName = oldLocations.filter((old) => normalizedLabel(old.label) === normalizedLabel(location.label) && old.kind === location.kind && !matchedOldLocations.has(old.id));
    const match = byId.length === 1 ? byId[0] : byId.length > 1 ? undefined : byName.length === 1 ? byName[0] : undefined;
    if ((byId.length > 1 || (!byId.length && byName.length > 1)) && previous) reviewReasons.push("ambiguous_location_identity");
    let id = match?.id ?? location.id;
    if (!match && reservedLocationIds.has(id)) {
      id = unusedId("location-", new Set([...reservedLocationIds, ...usedLocationIds]));
      reviewReasons.push("location_id_reused_for_different_place");
    }
    if (usedLocationIds.has(id)) {
      id = unusedId("location-", usedLocationIds);
      reviewReasons.push("duplicate_location_identity");
    }
    usedLocationIds.add(id);
    candidateToStable.set(location.id, id);
    if (match) matchedOldLocations.add(match.id);
    return match ? { ...location, id: match.id, x: match.x, y: match.y } : { ...location, id };
  });
  if (oldLocations.some((old) => !matchedOldLocations.has(old.id))) reviewReasons.push("previous_locations_not_confidently_matched");

  const matchedOldRoadIds = new Set<string>();
  const usedRoadIds = new Set<string>();
  const reservedRoadIds = new Set(oldRoads.map((road) => road.id));
  const roads = candidate.roads.map((road) => {
    const from = candidateToStable.get(road.from);
    const to = candidateToStable.get(road.to);
    if (!from || !to) throw new ApiError(502, "provider_invalid_map");
    const prior = oldRoads.filter((old) => edgeKey(old.from, old.to) === edgeKey(from, to) && !matchedOldRoadIds.has(old.id));
    const match = prior.length === 1 ? prior[0] : undefined;
    if (prior.length > 1 && previous) reviewReasons.push("ambiguous_road_identity");
    let id = match?.id ?? road.id;
    if (!match && reservedRoadIds.has(id)) {
      id = unusedId("road-", new Set([...reservedRoadIds, ...usedRoadIds]));
      reviewReasons.push("road_id_reused_for_different_edge");
    }
    if (usedRoadIds.has(id)) {
      id = unusedId("road-", usedRoadIds);
      reviewReasons.push("duplicate_road_identity");
    }
    usedRoadIds.add(id);
    if (match) matchedOldRoadIds.add(match.id);
    return { ...road, id, from, to };
  });
  if (oldRoads.some((old) => !matchedOldRoadIds.has(old.id))) reviewReasons.push("previous_roads_not_confidently_matched");
  return { map: paperMapSchema.parse({ locations, roads }), reviewReasons: [...new Set(reviewReasons)] };
}

function buildMapPrompt(previous?: PaperMap): string {
  return [
    "Interpret the attached map image and return only the visible locations and roads in the required JSON schema.",
    "Use only visible evidence. Do not add a road, location, connection, label, or status that is not clearly shown.",
    "Estimate x and y as percentages from the full image (0 is left/top, 100 is right/bottom). Use location kinds depot, home, shop, or junction.",
    "A road is closed only when the image explicitly marks it closed. Do not infer routes or fill gaps.",
    "If a prior map is included, reuse its location IDs when the same labeled place is visibly identifiable, and return current positions only as estimates; the server preserves prior coordinates for matched places. Reuse IDs only when confident.",
    previous ? `Prior map context (identity hints only): ${JSON.stringify(previous)}` : "No prior map is provided.",
  ].join("\n");
}

export async function parseMapImage(image: string, previous?: PaperMap): Promise<MapParseResult> {
  const { bytes } = validateImage(image);
  if (apiEnabled()) {
    const result = await callOpenAi({
      model: openAiModel(),
      system: "You are a visual map transcription service. Return only visible graph data matching the schema. Do not infer missing roads or perform routing.",
      user: buildMapPrompt(previous),
      image,
      schemaName: "paperworld_map",
      schema: locationSchemaForCodex,
    });
    const candidate = paperMapSchema.safeParse(result.value);
    if (!candidate.success) throw new ApiError(502, "provider_invalid_map");
    const reconciled = reconcileMap(candidate.data, previous);
    return { map: reconciled.map, provider: "openai", model: result.model, latencyMs: result.latencyMs, requiresReview: true, reviewReasons: reconciled.reviewReasons };
  }

  const result = await runCodexJson({ prompt: buildMapPrompt(previous), schema: locationSchemaForCodex, image: bytes });
  const candidate = paperMapSchema.safeParse(result.value);
  if (!candidate.success) throw new ApiError(502, "provider_invalid_map");
  const reconciled = reconcileMap(candidate.data, previous);
  return { map: reconciled.map, provider: "codex", model: result.model, latencyMs: result.latencyMs, requiresReview: true, reviewReasons: reconciled.reviewReasons };
}

function exactMentions(text: string, entries: Array<{ id: string; name: string }>): string[] {
  const normalized = normalizedLabel(text);
  return entries.filter((entry) => {
    const choices = [entry.id, entry.name].map(normalizedLabel).filter((part) => part.length > 0);
    return choices.some((part) => {
      const escaped = part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      return new RegExp(`(^|[^\\p{L}\\p{N}])${escaped}($|[^\\p{L}\\p{N}])`, "u").test(normalized);
    });
  }).map((entry) => entry.id);
}

function validateProposedCommands(commands: Command[], context: z.infer<typeof commandRequestSchema>): string | null {
  const locations = new Set(context.map.locations.map((location) => location.id));
  const roads = new Set(context.map.roads.map((road) => road.id));
  const packages = new Map(context.packages.map((pkg) => [pkg.id, pkg]));
  const couriers = new Map(context.couriers.map((courier) => [courier.id, courier]));
  for (const command of commands) {
    if (command.type === "create-package" && (!locations.has(command.from) || !locations.has(command.to) || command.from === command.to)) return "Choose two different locations on this map.";
    if (command.type === "set-road" && !roads.has(command.roadId)) return "Choose a road on this map.";
    if (command.type === "set-priority" && !packages.has(command.packageId)) return "Choose an existing package.";
    if (command.type === "assign-package" && (!packages.has(command.packageId) || !couriers.has(command.courierId))) return "Choose an existing package and courier.";
  }
  return null;
}

function clarification(text: string, provider: CommandProposal["provider"], model: string, latencyMs: number): CommandProposal {
  return { commands: [], clarification: text, provider, model, latencyMs };
}

async function callTypeSafeDecision(text: string, context: z.infer<typeof commandRequestSchema>): Promise<{ choices: Record<string, string>; confidence: number; model: string; latencyMs: number }> {
  const apiKey = process.env.TYPESAFE_API_KEY;
  if (!apiKey) throw new ApiError(503, "typesafe_unavailable");
  const state = JSON.stringify({ request: text, locations: context.map.locations.map(({ id, label, kind }) => ({ id, label, kind })), roads: context.map.roads.map(({ id, from, to, closed }) => ({ id, from, to, closed })), packages: context.packages.map(({ id, from, to, priority, status }) => ({ id, from, to, priority, status })), couriers: context.couriers.map(({ id, name }) => ({ id, name })) });
  const payload = {
    state,
    model: typeSafeModel(),
    questions: {
      operation: { type: "choice", instructions: "Classify the one requested operation. Do not choose entities or plan routes. If multiple operations are requested, the instruction is unclear, or the request does not match one choice, choose clarify.", criteria: { create_package: "Create one package between two stated locations.", set_priority: "Change one existing package priority.", set_road: "Open or close one stated road.", assign_package: "Assign one existing package to one stated courier.", clarify: "The request is ambiguous, compound, or does not fit a single operation." } },
      priority: { type: "choice", instructions: "Choose the priority explicitly requested. If no priority is stated, choose unspecified.", criteria: { normal: "The request explicitly says normal or standard priority.", urgent: "The request explicitly says urgent or high priority.", unspecified: "No explicit priority is stated." } },
      road_state: { type: "choice", instructions: "Choose the requested state for a road. If no road state is explicitly requested, choose unspecified.", criteria: { open: "The request explicitly asks to open or reopen a road.", closed: "The request explicitly asks to close a road.", unspecified: "No road state is stated." } },
    },
  };
  const started = performance.now();
  let response: Response;
  try {
    response = await fetch("https://api.typesafe.ai/v1/systemone", { method: "POST", headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" }, body: JSON.stringify(payload), signal: AbortSignal.timeout(TYPE_SAFE_TIMEOUT_MS) });
  } catch (error) {
    throw new ApiError(error instanceof Error && error.name === "TimeoutError" ? 504 : 502, error instanceof Error && error.name === "TimeoutError" ? "provider_timeout" : "typesafe_request_failed");
  }
  if (!response.ok) throw new ApiError(response.status === 429 ? 503 : 502, "typesafe_request_failed");
  const body = typeSafeResponseSchema.safeParse(await readLimitedJson(response, 32_000));
  if (!body.success) throw new ApiError(502, "typesafe_invalid_response");
  const choices: Record<string, string> = {};
  let confidence = 1;
  for (const key of ["operation", "priority", "road_state"]) {
    const answer = body.data.answers[key];
    if (!answer) throw new ApiError(502, "typesafe_invalid_response");
    choices[key] = answer.choice;
    confidence = Math.min(confidence, answer.confidence);
  }
  return { choices, confidence, model: body.data.model, latencyMs: Math.round(performance.now() - started) };
}

async function proposeWithJev(context: z.infer<typeof commandRequestSchema>): Promise<CommandProposal> {
  const result = await callTypeSafeDecision(context.text, context);
  if (result.confidence < 0.68 || result.choices.operation === "clarify") return clarification("Please state one operation clearly, such as create a package, change a package priority, open or close a road, or assign a package.", "typesafe", result.model, result.latencyMs);
  const mapEntries = context.map.locations.map((location) => ({ id: location.id, name: location.label }));
  const packageEntries = context.packages.map((pkg) => ({ id: pkg.id, name: pkg.id }));
  const courierEntries = context.couriers.map((courier) => ({ id: courier.id, name: courier.name }));
  const roadEntries = context.map.roads.map((road) => ({ id: road.id, name: `${road.id} ${road.from} ${road.to}` }));
  const mentionedLocations = exactMentions(context.text, mapEntries);
  const mentionedPackages = exactMentions(context.text, packageEntries);
  const mentionedCouriers = exactMentions(context.text, courierEntries);
  const mentionedRoads = exactMentions(context.text, roadEntries);
  let commands: Command[] = [];

  switch (result.choices.operation) {
    case "create_package": {
      const explicitOrder = /\bfrom\s+(.+?)\s+to\s+(.+?)(?:\s+(?:with|as|priority|urgent|normal)\b|$)/i.exec(context.text);
      const fromMatch = explicitOrder ? exactMentions(explicitOrder[1], mapEntries) : [];
      const toMatch = explicitOrder ? exactMentions(explicitOrder[2], mapEntries) : [];
      const from = fromMatch.length === 1 ? fromMatch[0] : undefined;
      const to = toMatch.length === 1 ? toMatch[0] : undefined;
      if (!from || !to || from === to || result.choices.priority === "unspecified") return clarification("Which two different locations should the package go between, and should its priority be normal or urgent?", "typesafe", result.model, result.latencyMs);
      commands = [{ type: "create-package", from, to, priority: result.choices.priority === "urgent" ? "urgent" : "normal" }];
      break;
    }
    case "set_priority":
      if (mentionedPackages.length !== 1 || !["normal", "urgent"].includes(result.choices.priority)) return clarification("Which existing package should change, and should its priority be normal or urgent?", "typesafe", result.model, result.latencyMs);
      commands = [{ type: "set-priority", packageId: mentionedPackages[0], priority: result.choices.priority as "normal" | "urgent" }];
      break;
    case "set_road":
      if (mentionedRoads.length !== 1 || !["open", "closed"].includes(result.choices.road_state)) return clarification("Which road should change, and should it be open or closed?", "typesafe", result.model, result.latencyMs);
      commands = [{ type: "set-road", roadId: mentionedRoads[0], closed: result.choices.road_state === "closed" }];
      break;
    case "assign_package":
      if (mentionedPackages.length !== 1 || mentionedCouriers.length !== 1) return clarification("Which existing package should be assigned to which courier?", "typesafe", result.model, result.latencyMs);
      commands = [{ type: "assign-package", packageId: mentionedPackages[0], courierId: mentionedCouriers[0] }];
      break;
    default:
      return clarification("Please clarify the requested operation.", "typesafe", result.model, result.latencyMs);
  }
  const error = validateProposedCommands(commands, context);
  return error ? clarification(error, "typesafe", result.model, result.latencyMs) : { commands, clarification: null, provider: "typesafe", model: result.model, latencyMs: result.latencyMs };
}

function codexCommandPrompt(context: z.infer<typeof commandRequestSchema>): string {
  return [
    "Return a proposal matching the JSON schema. Never execute it or modify the supplied state.",
    "Interpret the request against only the listed entities. Do not invent IDs, assign a future package ID, or choose paths, routes, or difficulty.",
    "The `commands` array may contain multiple directly requested, unambiguous commands. If an entity or meaning is ambiguous, return an empty array and ask one concise question in `clarification`.",
    "For create-package, use only explicitly named existing locations and the requested priority (normal if explicitly normal; urgent if explicitly urgent). For a compound create-and-assign request, use it only if the user explicitly identifies an existing package, otherwise ask for clarification.",
    `Request: ${JSON.stringify(context.text)}`,
    `Available map, packages, and couriers: ${JSON.stringify({ map: context.map, packages: context.packages.map(({ id, from, to, priority, status, courierId }) => ({ id, from, to, priority, status, courierId })), couriers: context.couriers.map(({ id, name, locationId, packageIds, capacity }) => ({ id, name, locationId, packageIds, capacity })) })}`,
  ].join("\n");
}

async function proposeWithCodex(context: z.infer<typeof commandRequestSchema>): Promise<CommandProposal> {
  const result = await runCodexJson({ prompt: codexCommandPrompt(context), schema: commandProposalJsonSchema });
  const parsed = commandProposalSchema.safeParse(result.value);
  if (!parsed.success) throw new ApiError(502, "provider_invalid_response");
  const entityError = validateProposedCommands(parsed.data.commands, context);
  if (entityError) return clarification(entityError, "codex", result.model, result.latencyMs);
  return { ...parsed.data, provider: "codex", model: result.model, latencyMs: result.latencyMs };
}

async function callOpenAi(options: { model: string; system: string; user: string; schemaName: string; schema: unknown; image?: string }): Promise<{ value: unknown; model: string; latencyMs: number }> {
  if (!apiEnabled()) throw new ApiError(403, "paid_api_not_enabled");
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey || !options.model) throw new ApiError(503, "openai_api_unavailable");
  const userContent: Array<Record<string, string>> = [{ type: "input_text", text: options.user }];
  if (options.image) userContent.push({ type: "input_image", image_url: options.image });
  const started = performance.now();
  let response: Response;
  try {
    response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
      body: JSON.stringify({ model: options.model, store: false, max_output_tokens: 3_000, input: [{ role: "system", content: [{ type: "input_text", text: options.system }] }, { role: "user", content: userContent }], text: { format: { type: "json_schema", name: options.schemaName, strict: true, schema: options.schema } } }),
      signal: AbortSignal.timeout(OPENAI_TIMEOUT_MS),
    });
  } catch (error) {
    throw new ApiError(error instanceof Error && error.name === "TimeoutError" ? 504 : 502, error instanceof Error && error.name === "TimeoutError" ? "provider_timeout" : "openai_api_request_failed");
  }
  if (!response.ok) throw new ApiError(response.status === 429 ? 503 : 502, "openai_api_request_failed");
  const payload = await readLimitedJson(response, MAX_PROVIDER_OUTPUT_BYTES);
  if (!payload || typeof payload !== "object") throw new ApiError(502, "provider_invalid_response");
  const record = payload as Record<string, unknown>;
  const outputText = typeof record.output_text === "string" ? record.output_text : extractOutputText(record.output);
  if (!outputText || Buffer.byteLength(outputText) > MAX_PROVIDER_OUTPUT_BYTES) throw new ApiError(502, "provider_invalid_response");
  let value: unknown;
  try { value = JSON.parse(outputText) as unknown; } catch { throw new ApiError(502, "provider_invalid_response"); }
  return { value, model: typeof record.model === "string" ? record.model.slice(0, 80) : options.model, latencyMs: Math.round(performance.now() - started) };
}

function extractOutputText(output: unknown): string | undefined {
  if (!Array.isArray(output)) return undefined;
  for (const item of output) {
    if (!item || typeof item !== "object") continue;
    const content = (item as Record<string, unknown>).content;
    if (!Array.isArray(content)) continue;
    for (const part of content) if (part && typeof part === "object" && (part as Record<string, unknown>).type === "output_text" && typeof (part as Record<string, unknown>).text === "string") return (part as Record<string, string>).text;
  }
  return undefined;
}

async function readLimitedJson(response: Response, maxBytes: number): Promise<unknown> {
  const length = response.headers.get("content-length");
  if (length && /^\d+$/.test(length) && Number(length) > maxBytes) throw new ApiError(502, "provider_output_too_large");
  if (!response.body) throw new ApiError(502, "provider_invalid_response");
  const reader = response.body.getReader(); const chunks: Uint8Array[] = []; let bytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read(); if (done) break;
      bytes += value.byteLength;
      if (bytes > maxBytes) { await reader.cancel(); throw new ApiError(502, "provider_output_too_large"); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  try { return JSON.parse(Buffer.concat(chunks.map((chunk) => Buffer.from(chunk))).toString("utf8")) as unknown; }
  catch { throw new ApiError(502, "provider_invalid_response"); }
}

async function proposeWithOpenAiApi(context: z.infer<typeof commandRequestSchema>): Promise<CommandProposal> {
  const result = await callOpenAi({
    model: openAiModel(),
    system: "Convert the user's instruction into one or more typed command proposals. Return only valid commands supported by the supplied entities. Do not execute commands, mutate state, or choose paths or routes. If meaning or entity identity is unclear, return an empty commands array and ask one concise question.",
    user: codexCommandPrompt(context),
    schemaName: "paperworld_command_proposal",
    schema: commandProposalJsonSchema,
  });
  const parsed = commandProposalSchema.safeParse(result.value);
  if (!parsed.success) throw new ApiError(502, "provider_invalid_response");
  const entityError = validateProposedCommands(parsed.data.commands, context);
  if (entityError) return clarification(entityError, "openai", result.model, result.latencyMs);
  return { ...parsed.data, provider: "openai", model: result.model, latencyMs: result.latencyMs };
}

export async function proposeCommand(input: unknown): Promise<CommandProposal> {
  const parsed = commandRequestSchema.safeParse(input);
  if (!parsed.success) throw new ApiError(400, "invalid_command_request");
  if (parsed.data.mode === "jev") return proposeWithJev(parsed.data);
  return apiEnabled() ? proposeWithOpenAiApi(parsed.data) : proposeWithCodex(parsed.data);
}

async function isCodexReady(): Promise<boolean> {
  try {
    const environment = createCodexEnvironment(); const launcher = findCodexLauncher(environment);
    return await new Promise<boolean>((resolve) => {
      const child = spawn(launcher.command, [...launcher.prefixArgs, "login", "status"], { env: environment, shell: false, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
      let text = ""; let settled = false; const finish = (ready: boolean) => { if (!settled) { settled = true; resolve(ready); } };
      const timeout = setTimeout(() => { child.kill(); finish(false); }, 4_000);
      child.stdout.on("data", (chunk: Buffer) => { if (text.length < 4_096) text += chunk.toString("utf8"); else { child.kill(); finish(false); } });
      child.stderr.on("data", (chunk: Buffer) => { if (text.length < 4_096) text += chunk.toString("utf8"); });
      child.once("error", () => { clearTimeout(timeout); finish(false); });
      child.once("close", (code) => {
        clearTimeout(timeout);
        finish(code === 0 && /logged\s+in.{0,80}chatgpt/i.test(text) && !/not\s+logged\s+in/i.test(text));
      });
    });
  } catch { return false; }
}

export async function getProviderStatus(): Promise<ProviderStatus> {
  const api = apiEnabled();
  const codexReady = await isCodexReady();
  const typesafeReady = Boolean(process.env.TYPESAFE_API_KEY);
  const openaiReady = api && Boolean(process.env.OPENAI_API_KEY && openAiModel());
  return {
    image: api ? { provider: "openai", ready: openaiReady, model: openAiModel(), detail: openaiReady ? "Paid API enabled" : "Paid API configuration incomplete" }
      : { provider: "codex", ready: codexReady, model: "ChatGPT sign-in", detail: codexReady ? "Local Codex sign-in available" : "Local Codex sign-in unavailable" },
    command: api ? { provider: "openai", ready: openaiReady, model: openAiModel(), detail: openaiReady ? "Paid API enabled" : "Paid API configuration incomplete" }
      : { provider: "codex", ready: codexReady, model: "ChatGPT sign-in", detail: codexReady ? "Local Codex sign-in available" : "Local Codex sign-in unavailable" },
    jev: { ready: typesafeReady, model: typeSafeModel() },
    openaiApi: { enabled: api, ready: openaiReady, model: openAiModel() },
  };
}

export { commandSchema, commandsSchema };
