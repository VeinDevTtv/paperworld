import { execFileSync } from "node:child_process";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { loadEnvConfig } from "@next/env";

const root = process.cwd();
const maxScanBytes = 12_000_000;
const exactSecretNames = /(?:API_KEY|ACCESS_TOKEN|AUTH_TOKEN|SECRET|PASSWORD|PRIVATE_KEY|CLIENT_SECRET)$/i;
const knownSecretPatterns: Array<{ code: string; pattern: RegExp }> = [
  { code: "openai_key_pattern", pattern: /\bsk-(?:proj-)?[A-Za-z0-9_-]{24,}\b/g },
  { code: "provider_key_pattern", pattern: /\b(?:jev|ts)_[A-Za-z0-9_-]{24,}\b/g },
  { code: "github_token_pattern", pattern: /\b(?:github_pat_[A-Za-z0-9_]{30,}|gh[pousr]_[A-Za-z0-9]{20,})\b/g },
  { code: "private_key_block", pattern: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g },
  { code: "credential_assignment", pattern: /^[ \t]*(?:[A-Z0-9_]*(?:API_KEY|ACCESS_TOKEN|AUTH_TOKEN|SECRET|PASSWORD|PRIVATE_KEY|CLIENT_SECRET))[ \t]*=[ \t]*(['"]?)(?!\$\{|<|your[_-]|change[_-]?me|placeholder|example)([^'"\s#]{16,})\1[ \t]*$/gim },
  { code: "bearer_token", pattern: /\bBearer\s+[A-Za-z0-9._~-]{24,}\b/g },
];

function isPlaceholder(value: string): boolean {
  const normalized = value.trim().toLowerCase();
  return !normalized || normalized.startsWith("${") || /^<.*>$/.test(normalized) || /^(?:your[_-]|change[_-]?me|placeholder|example|replace[_-]?me)/.test(normalized);
}

function repoPaths(): string[] {
  const result = execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard", "-z"], { cwd: root, encoding: "buffer", maxBuffer: 16_000_000 });
  return result.toString("utf8").split("\0").filter(Boolean);
}

async function main(): Promise<void> {
  loadEnvConfig(root);
  const exactSecrets = Object.entries(process.env)
    .filter(([name, value]) => exactSecretNames.test(name) && typeof value === "string" && value.length >= 8 && !isPlaceholder(value))
    .map(([, value]) => Buffer.from(value as string, "utf8"));
  const paths = repoPaths();
  const failures: Array<{ file: string; code: string }> = [];
  let scanned = 0;

  for (const repoPath of paths) {
    const normalizedPath = repoPath.replace(/\\/g, "/");
    const baseName = path.posix.basename(normalizedPath);
    if (/^\.env(?:\.|$)/i.test(baseName) && baseName !== ".env.example") {
      failures.push({ file: normalizedPath, code: "environment_file_forbidden" });
      continue;
    }
    const absolutePath = path.resolve(root, repoPath);
    if (absolutePath !== root && !absolutePath.startsWith(`${root}${path.sep}`)) {
      failures.push({ file: normalizedPath, code: "path_outside_repository" });
      continue;
    }
    let fileStat;
    try { fileStat = await stat(absolutePath); } catch { continue; }
    if (!fileStat.isFile()) continue;
    if (fileStat.size > maxScanBytes) {
      failures.push({ file: normalizedPath, code: "file_too_large_to_scan" });
      continue;
    }
    let bytes: Buffer;
    try { bytes = await readFile(absolutePath); } catch { continue; }
    scanned += 1;
    for (const secret of exactSecrets) {
      if (bytes.indexOf(secret) !== -1) {
        failures.push({ file: normalizedPath, code: "loaded_secret_value" });
        break;
      }
    }
    if (bytes.includes(0)) continue;
    const content = bytes.toString("utf8");
    for (const { code, pattern } of knownSecretPatterns) {
      pattern.lastIndex = 0;
      if (pattern.test(content)) failures.push({ file: normalizedPath, code });
    }
  }

  if (failures.length) {
    console.error(`Secret check failed with ${failures.length} issue(s):`);
    for (const failure of failures) console.error(`- ${failure.file}: ${failure.code}`);
    process.exitCode = 1;
    return;
  }
  console.log(`Secret scan passed (${scanned} tracked or unignored files scanned).`);
}

main().catch(() => {
  console.error("Secret scan could not complete safely.");
  process.exitCode = 1;
});
