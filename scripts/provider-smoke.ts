import { createRequire } from "node:module";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { accessSync, constants as fsConstants } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { loadEnvConfig } from "@next/env";
import { z } from "zod";

const MAX_IMAGE_BYTES = 1_500_000;
const MAX_OUTPUT_BYTES = 32_000;
const CODEX_TIMEOUT_MS = 75_000;
const TYPESAFE_TIMEOUT_MS = 12_000;

const smokeMapSchema = z
  .object({
    locations: z
      .array(
        z.object({
          id: z.string().min(1).max(24),
          label: z.string().min(1).max(80),
          kind: z.enum(["depot", "home", "shop", "junction"]),
          x: z.number().min(0).max(100),
          y: z.number().min(0).max(100),
        }).strict(),
      )
      .max(32),
    roads: z
      .array(
        z.object({
          id: z.string().min(1).max(24),
          from: z.string().min(1).max(24),
          to: z.string().min(1).max(24),
          closed: z.boolean(),
        }).strict(),
      )
      .max(64),
  })
  .strict()
  .superRefine((map, context) => {
    const locationIds = new Set<string>();
    for (const [index, location] of map.locations.entries()) {
      if (locationIds.has(location.id)) {
        context.addIssue({ code: "custom", path: ["locations", index, "id"], message: "Duplicate location id" });
      }
      locationIds.add(location.id);
    }

    const roadIds = new Set<string>();
    for (const [index, road] of map.roads.entries()) {
      if (roadIds.has(road.id)) {
        context.addIssue({ code: "custom", path: ["roads", index, "id"], message: "Duplicate road id" });
      }
      roadIds.add(road.id);
      if (!locationIds.has(road.from) || !locationIds.has(road.to) || road.from === road.to) {
        context.addIssue({ code: "custom", path: ["roads", index], message: "Road must connect two known locations" });
      }
    }
  });

type SmokeMap = z.infer<typeof smokeMapSchema>;

const schemaForCodex = {
  type: "object",
  additionalProperties: false,
  properties: {
    locations: {
      type: "array",
      maxItems: 32,
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          id: { type: "string" },
          label: { type: "string" },
          kind: { type: "string", enum: ["depot", "home", "shop", "junction"] },
          x: { type: "number", minimum: 0, maximum: 100 },
          y: { type: "number", minimum: 0, maximum: 100 },
        },
        required: ["id", "label", "kind", "x", "y"],
      },
    },
    roads: {
      type: "array",
      maxItems: 64,
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          id: { type: "string" },
          from: { type: "string" },
          to: { type: "string" },
          closed: { type: "boolean" },
        },
        required: ["id", "from", "to", "closed"],
      },
    },
  },
  required: ["locations", "roads"],
} as const;

const pngSchema = z.object({}).passthrough();
const typeSafeResponseSchema = z.object({
  model: z.string(),
  answers: z.record(z.string(), z.object({
    type: z.literal("choice"),
    choice: z.string(),
    probabilities: z.record(z.string(), z.number().min(0).max(1)),
    confidence: z.number().min(0).max(1),
  })),
  usage: z.object({ input_tokens: z.number().int().nonnegative(), output_tokens: z.number().int().nonnegative() }).optional(),
});

function svgForSmokeMap(): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="480" viewBox="0 0 640 480">
    <rect width="640" height="480" fill="#f4f1e8"/>
    <rect x="18" y="18" width="604" height="444" rx="18" fill="#f7f5ee" stroke="#d5d0c4" stroke-width="2"/>
    <text x="40" y="52" font-family="Arial,sans-serif" font-size="17" font-weight="700" fill="#243244">PAPERWORLD MAP</text>
    <text x="410" y="52" font-family="Arial,sans-serif" font-size="12" fill="#536174">RED X = CLOSED</text>
    <path d="M94 232 L320 232" fill="none" stroke="#8c98a6" stroke-width="14" stroke-linecap="round"/>
    <path d="M320 232 L548 120" fill="none" stroke="#8c98a6" stroke-width="14" stroke-linecap="round"/>
    <path d="M320 232 L320 382" fill="none" stroke="#8c98a6" stroke-width="14" stroke-linecap="round"/>
    <path d="M320 285 L320 329" fill="none" stroke="#f7f5ee" stroke-width="18"/>
    <path d="M309 299 L331 321 M331 299 L309 321" fill="none" stroke="#cf3444" stroke-width="8" stroke-linecap="round"/>
    <circle cx="94" cy="232" r="22" fill="#e1a445" stroke="#243244" stroke-width="3"/>
    <circle cx="548" cy="120" r="22" fill="#5aa7d5" stroke="#243244" stroke-width="3"/>
    <circle cx="320" cy="382" r="22" fill="#78b87a" stroke="#243244" stroke-width="3"/>
    <circle cx="320" cy="232" r="22" fill="#a995d1" stroke="#243244" stroke-width="3"/>
    <text x="94" y="238" text-anchor="middle" font-family="Arial,sans-serif" font-size="17" font-weight="700" fill="#172033">A</text>
    <text x="548" y="126" text-anchor="middle" font-family="Arial,sans-serif" font-size="17" font-weight="700" fill="#172033">B</text>
    <text x="320" y="388" text-anchor="middle" font-family="Arial,sans-serif" font-size="17" font-weight="700" fill="#172033">C</text>
    <text x="320" y="238" text-anchor="middle" font-family="Arial,sans-serif" font-size="17" font-weight="700" fill="#172033">J</text>
    <text x="57" y="278" font-family="Arial,sans-serif" font-size="13" font-weight="700" fill="#243244">DEPOT</text>
    <text x="511" y="164" font-family="Arial,sans-serif" font-size="13" font-weight="700" fill="#243244">HOME</text>
    <text x="286" y="425" font-family="Arial,sans-serif" font-size="13" font-weight="700" fill="#243244">SHOP</text>
    <text x="278" y="194" font-family="Arial,sans-serif" font-size="13" font-weight="700" fill="#243244">JUNCTION</text>
    <text x="40" y="440" font-family="Arial,sans-serif" font-size="11" fill="#6a7280">Locations are marked A, B, C, J. Approximate positions from the visible map.</text>
  </svg>`;
}

async function createCodexAuthEnvironment(): Promise<NodeJS.ProcessEnv> {
  const inherited = process.env;
  const safeNames = [
    "PATH", "Path", "SystemRoot", "WINDIR", "USERPROFILE", "HOMEDRIVE", "HOMEPATH",
    "APPDATA", "LOCALAPPDATA", "TEMP", "TMP", "CODEX_HOME", "npm_config_prefix", "LANG", "LC_ALL",
  ];
  const safe: NodeJS.ProcessEnv = { NODE_ENV: "production" };
  for (const name of safeNames) if (inherited[name]) safe[name] = inherited[name];
  // The CLI uses its saved ChatGPT login. Never pass API credentials into this child.
  for (const name of ["OPENAI_API_KEY", "TYPESAFE_API_KEY", "CODEX_API_KEY", "CODEX_ACCESS_TOKEN"]) {
    delete safe[name];
  }
  return safe;
}

function findCodexLauncher(environment: NodeJS.ProcessEnv): { command: string; prefixArgs: string[] } {
  const npmRoots = [
    environment.APPDATA ? path.join(environment.APPDATA, "npm", "node_modules") : "",
    environment.npm_config_prefix ? path.join(environment.npm_config_prefix, "node_modules") : "",
    environment.npm_config_prefix ? path.join(environment.npm_config_prefix, "lib", "node_modules") : "",
    path.join(os.homedir(), ".npm-global", "lib", "node_modules"),
  ].filter(Boolean);
  for (const root of npmRoots) {
    const packageRoot = path.join(root, "@openai", "codex");
    if (process.platform === "win32" && (process.arch === "x64" || process.arch === "arm64")) {
      const packageName = process.arch === "arm64" ? "codex-win32-arm64" : "codex-win32-x64";
      const triple = process.arch === "arm64" ? "aarch64-pc-windows-msvc" : "x86_64-pc-windows-msvc";
      const native = path.join(packageRoot, "node_modules", "@openai", packageName, "vendor", triple, "bin", "codex.exe");
      try {
        accessSync(native, fsConstants.X_OK);
        return { command: native, prefixArgs: [] };
      } catch {
        // Check the sibling package layout used by some npm installs.
      }
      const siblingNative = path.join(root, "@openai", packageName, "vendor", triple, "bin", "codex.exe");
      try {
        accessSync(siblingNative, fsConstants.X_OK);
        return { command: siblingNative, prefixArgs: [] };
      } catch {
        // Continue to the configured PATH executable.
      }
    }
    if (process.platform !== "win32") {
      const entrypoint = path.join(packageRoot, "bin", "codex.js");
      try {
        accessSync(entrypoint, fsConstants.R_OK);
        return { command: process.execPath, prefixArgs: [entrypoint] };
      } catch {
        // Keep looking through standard npm global install roots.
      }
    }
  }
  // On Windows the npm shim can spawn a native child that child.kill() will
  // leave running after a timeout. Require the platform binary instead.
  if (process.platform === "win32") {
    throw new Error("Native Codex CLI was not found for this Windows architecture; refusing the npm JavaScript shim.");
  }
  const pathEntries = (environment.PATH ?? environment.Path ?? "").split(path.delimiter);
  const names = ["codex"];
  for (const entry of pathEntries) {
    for (const name of names) {
      const candidate = path.join(entry, name);
      try {
        accessSync(candidate, fsConstants.X_OK);
        return { command: candidate, prefixArgs: [] };
      } catch {
        // Continue through PATH without printing any environment values.
      }
    }
  }
  throw new Error("Codex CLI executable was not found on PATH.");
}

async function runCodexImageParse(imagePath: string, schemaPath: string, outputPath: string, cwd: string): Promise<{ result: SmokeMap; elapsedMs: number }> {
  const environment = await createCodexAuthEnvironment();
  const launcher = findCodexLauncher(environment);
  const args = [
    "exec", "--ephemeral", "--ignore-user-config", "--ignore-rules", "--skip-git-repo-check", "--sandbox", "read-only",
    "-c", "features.shell_tool=false", "-c", "features.unified_exec=false", "-c", "features.apply_patch_freeform=false",
    "-c", 'web_search="disabled"', "-c", 'forced_login_method="chatgpt"', "--json",
    "--cd", cwd, "--image", imagePath, "--output-schema", schemaPath, "--output-last-message", outputPath, "-",
  ];
  const prompt = [
    "Read the attached synthetic map image and return only the map object required by the supplied JSON schema.",
    "Use the visible letter IDs and labels. Estimate x and y as percentages of the full image, with x increasing left to right and y increasing top to bottom.",
    "Use kind values depot, home, shop, or junction based on the visible label.",
    "Return every visible road once. A road is closed only when the red X marks it closed.",
    "Do not run commands, call tools, fetch URLs, or infer hidden locations or roads.",
  ].join("\n");

  const started = performance.now();
  await new Promise<void>((resolve, reject) => {
    const child = spawn(launcher.command, [...launcher.prefixArgs, ...args], { cwd, env: environment, shell: false, windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
    let stderrBytes = 0;
    let stdoutBytes = 0;
    let forcedError: Error | undefined;
    const stdoutChunks: Buffer[] = [];
    let timer: NodeJS.Timeout | undefined;
    let settled = false;
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      if (error) reject(error);
      else resolve();
    };

    timer = setTimeout(() => {
      child.kill();
      forcedError = new Error("Codex image interpretation exceeded its time limit.");
    }, CODEX_TIMEOUT_MS);

    child.stderr.on("data", (chunk: Buffer) => {
      stderrBytes += chunk.length;
      if (stderrBytes > MAX_OUTPUT_BYTES) {
        child.kill();
        forcedError = new Error("Codex image interpretation exceeded its output limit.");
      }
    });
    child.stdout.on("data", (chunk: Buffer) => {
      stdoutBytes += chunk.length;
      if (stdoutBytes > MAX_OUTPUT_BYTES) {
        child.kill();
        forcedError = new Error("Codex event stream exceeded its output limit.");
      } else {
        stdoutChunks.push(chunk);
      }
    });
    child.once("error", () => finish(new Error("Codex CLI could not be started.")));
    child.once("close", (code) => {
      if (settled) return;
      if (forcedError) {
        finish(forcedError);
        return;
      }
      if (code !== 0) {
        finish(new Error("Codex image interpretation did not complete successfully."));
        return;
      }
      for (const line of Buffer.concat(stdoutChunks).toString("utf8").split(/\r?\n/)) {
        if (!line) continue;
        let event: unknown;
        try {
          event = JSON.parse(line);
        } catch {
          finish(new Error("Codex returned an invalid event stream."));
          return;
        }
        if (containsToolRequest(event)) {
          finish(new Error("Codex requested a tool action; the image smoke allows image-only output."));
          return;
        }
      }
      finish();
    });
    child.stdin.end(prompt);
  });

  const output = await readFile(outputPath);
  if (output.length > MAX_OUTPUT_BYTES) throw new Error("Codex response exceeded its output limit.");
  const decoded = JSON.parse(output.toString("utf8")) as unknown;
  return { result: smokeMapSchema.parse(decoded), elapsedMs: Math.round(performance.now() - started) };
}

function containsToolRequest(value: unknown): boolean {
  const forbidden = new Set([
    "command_execution", "local_shell_call", "shell_call", "mcp_tool_call", "web_search_call",
    "computer_call", "function_call", "file_change", "apply_patch",
  ]);
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  if (typeof record.type === "string" && forbidden.has(record.type)) return true;
  for (const nested of Object.values(record)) {
    if (Array.isArray(nested) ? nested.some(containsToolRequest) : containsToolRequest(nested)) return true;
  }
  return false;
}

async function callTypeSafe(map: SmokeMap): Promise<{ model: string; decision: string; confidence: number; inputTokens: number; outputTokens: number; elapsedMs: number }> {
  loadEnvConfig(process.cwd());
  const apiKey = process.env.TYPESAFE_API_KEY;
  if (!apiKey) throw new Error("TYPESAFE_API_KEY is unavailable; TypeSafe smoke request was not sent.");

  const payload = {
    state: "Set package pkg-1 to urgent.",
    model: "jev-latest",
    questions: {
      command_type: {
        type: "choice",
        instructions: "Which supported operation is explicitly requested? Classify only the requested operation; do not plan a route or make a pathfinding judgment.",
        criteria: {
          create_package: "The text asks to create a package.",
          set_priority: "The text asks to change a package priority.",
          set_road: "The text asks to open or close a road.",
          assign_package: "The text asks to assign a package to a courier.",
          clarify: "The text does not clearly ask for one supported operation.",
        },
      },
      priority: {
        type: "choice",
        instructions: "Which package priority is explicitly requested? Do not infer priority from map or route details.",
        criteria: {
          normal: "The text requests normal priority.",
          urgent: "The text requests urgent priority.",
          unspecified: "No priority is stated.",
        },
      },
    },
  };

  const started = performance.now();
  const response = await fetch("https://api.typesafe.ai/v1/systemone", {
    method: "POST",
    headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(TYPESAFE_TIMEOUT_MS),
  });
  if (!response.ok) {
    // Do not log or expose the response body; only the HTTP status is relevant to this smoke.
    throw new Error(`TypeSafe request failed with HTTP ${response.status}.`);
  }
  const body = typeSafeResponseSchema.parse(await readLimitedResponseJson(response, MAX_OUTPUT_BYTES));
  const actionAnswer = body.answers.command_type;
  const priorityAnswer = body.answers.priority;
  if (!actionAnswer || !priorityAnswer) throw new Error("TypeSafe response omitted a smoke answer.");
  return {
    model: body.model,
    decision: `${actionAnswer.choice}/${priorityAnswer.choice}`,
    confidence: Math.min(actionAnswer.confidence, priorityAnswer.confidence),
    inputTokens: body.usage?.input_tokens ?? 0,
    outputTokens: body.usage?.output_tokens ?? 0,
    elapsedMs: Math.round(performance.now() - started),
  };
}

async function readLimitedResponseJson(response: Response, maxBytes: number): Promise<unknown> {
  const length = response.headers.get("content-length");
  if (length && /^\d+$/.test(length) && Number(length) > maxBytes) throw new Error("TypeSafe response exceeded its output limit.");
  if (!response.body) throw new Error("TypeSafe response body is empty.");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) {
        await reader.cancel();
        throw new Error("TypeSafe response exceeded its output limit.");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  try {
    return JSON.parse(Buffer.concat(chunks.map((chunk) => Buffer.from(chunk))).toString("utf8")) as unknown;
  } catch {
    throw new Error("TypeSafe returned invalid JSON.");
  }
}

async function main(): Promise<void> {
  const temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), "paperworld-provider-smoke-"));
  try {
    const svg = svgForSmokeMap();
    const require = createRequire(path.join(process.cwd(), "package.json"));
    const sharp = require("sharp") as (input: Buffer) => { png(): { toBuffer(): Promise<Buffer> } };
    const image = await sharp(Buffer.from(svg, "utf8")).png().toBuffer();
    if (image.byteLength > MAX_IMAGE_BYTES) throw new Error("Synthetic image exceeded its byte limit.");
    const png = pngSchema.parse({ signature: image.subarray(0, 8).toString("hex") });
    if ((png as { signature?: string }).signature !== "89504e470d0a1a0a") throw new Error("Synthetic image is not a PNG.");
    const imagePath = path.join(temporaryDirectory, "synthetic-paperworld-map.png");
    const schemaPath = path.join(temporaryDirectory, "paperworld-map.schema.json");
    const outputPath = path.join(temporaryDirectory, "codex-map.json");
    await writeFile(imagePath, image);
    await writeFile(schemaPath, JSON.stringify(schemaForCodex));

    const codex = await runCodexImageParse(imagePath, schemaPath, outputPath, temporaryDirectory);
    const locations = new Map(codex.result.locations.map((location) => [location.id, location]));
    const depot = locations.get("A");
    const home = locations.get("B");
    const shop = locations.get("C");
    const junction = locations.get("J");
    if (!depot || depot.kind !== "depot" || !home || home.kind !== "home" || !shop || shop.kind !== "shop" || !junction || junction.kind !== "junction") {
      throw new Error("Codex did not identify the four visible map locations.");
    }
    const closedRoad = codex.result.roads.find((road) => road.closed);
    const edgeKey = (from: string, to: string) => [from, to].sort().join("-");
    const expectedEdges = ["A-J", "B-J", "C-J"].sort();
    const actualEdges = codex.result.roads.map((road) => edgeKey(road.from, road.to)).sort();
    const closedRoads = codex.result.roads.filter((road) => road.closed);
    if (
      codex.result.locations.length !== 4 || codex.result.roads.length !== 3 ||
      JSON.stringify(actualEdges) !== JSON.stringify(expectedEdges) || closedRoads.length !== 1 ||
      !closedRoad || edgeKey(closedRoad.from, closedRoad.to) !== "C-J"
    ) {
      throw new Error("Codex did not correctly interpret all visible map connections and the single marked closed road.");
    }

    const typeSafe = await callTypeSafe(codex.result);
    if (typeSafe.decision !== "set_priority/urgent") throw new Error(`TypeSafe classified the explicit command as ${typeSafe.decision}.`);

    const fingerprint = createHash("sha256").update(image).digest("hex").slice(0, 12);
    process.stdout.write(JSON.stringify({
      codex: { status: "passed", elapsed_ms: codex.elapsedMs, location_count: codex.result.locations.length, road_count: codex.result.roads.length, closed_road: closedRoad.id },
      typesafe: { status: "passed", model: typeSafe.model, decision: typeSafe.decision, confidence: typeSafe.confidence, elapsed_ms: typeSafe.elapsedMs, input_tokens: typeSafe.inputTokens, output_tokens: typeSafe.outputTokens },
      synthetic_image: { format: "png", bytes: image.byteLength, sha256_prefix: fingerprint },
    }, null, 2) + "\n");
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "Provider smoke failed.";
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
