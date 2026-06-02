/**
 * Memhook router — UserPromptSubmit hook entry point.
 *
 * Port of ~/.claude/hooks/memory-guard.sh (Phase 0.5 r5, 2026-05-28).
 *
 * Pipeline:
 *   1. Parse stdin: {"prompt", "cwd"}
 *   2. Toggle gate (config.enabled)
 *   3. Pre-filter trivial prompts (skip LLM entirely)
 *   4. Catalog & API key checks
 *   5. Local LRU cache (key: prompt + catalog_mtime + cwd + script_version)
 *   6. Provider call (Haiku 4.5 default, ttl 1h ephemeral)
 *   7. Parse JSON array of basenames, sanitise
 *   8. Read selected files with cap-by-tokens fix (projected size check)
 *   9. Emit {"hookSpecificOutput": {"additionalContext": "..."}}
 *  10. Append JSONL log entry
 *
 * Fail-soft: every error path falls back to empty additionalContext.
 * Never blocks Claude Code.
 */

import {
  existsSync,
  readFileSync,
  writeFileSync,
  openSync,
  fstatSync,
  closeSync,
  appendFileSync,
  mkdirSync,
  readdirSync,
} from "node:fs";
import { join, dirname, basename } from "node:path";
import { LocalCache } from "./cache.js";
import { loadConfig, type MemhookConfig } from "./config.js";
import { PreFilter } from "./preFilter.js";
import { createProvider } from "./providers/factory.js";

const SAFE_BASENAME_RE = /^[A-Za-z0-9._-]+\.md$/;

export interface HookInput {
  prompt: string;
  cwd?: string;
}

export interface HookOutput {
  hookSpecificOutput: {
    hookEventName: "UserPromptSubmit";
    additionalContext: string;
  };
  /**
   * Optional, additive (v0.4). A one-line warning shown to the user — used only
   * for the `/curate` nudge when the catalog grows large. Documented Claude Code
   * field; absent on every turn the nudge does not fire, so the existing output
   * shape is unchanged for existing consumers (docs/SPECIFICATION.md §10.2).
   */
  systemMessage?: string;
}

interface LogEntry {
  ts: string;
  promptPreview: string;
  selected: string[];
  latencyMs: number;
  tokensIn: number;
  tokensOut: number;
  cacheCreate: number;
  cacheRead: number;
  additionalSizeChars: number;
  additionalSizeTokensEst: number;
  status: string;
}

const EMPTY: HookOutput = {
  hookSpecificOutput: {
    hookEventName: "UserPromptSubmit",
    additionalContext: "",
  },
};

export async function route(
  stdinJson: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<HookOutput> {
  const config = loadConfig(env);
  ensureDirs(config);
  evictStale(config);

  if (!config.enabled) return EMPTY;

  let input: HookInput;
  try {
    input = JSON.parse(stdinJson) as HookInput;
  } catch {
    return EMPTY;
  }
  if (!input.prompt || typeof input.prompt !== "string") return EMPTY;
  const cwd = input.cwd ?? process.cwd();

  const preFilter = new PreFilter(config.preFilter.trivialWordsFile, config.preFilter.defaultWords);
  if (config.preFilter.enabled && preFilter.isTrivial(input.prompt)) {
    logEntry(config, baseLog(input.prompt, "pre_filter_skip"));
    return EMPTY;
  }

  // Read the catalog through a single fd: `fstat` gives the cache-key mtime and
  // we read the content from the same handle. Using one open fd — instead of
  // `existsSync`/`statSync` then `readFileSync` on the path — closes a
  // check-then-use window (CodeQL js/file-system-race). A missing or unreadable
  // catalog falls through to `no_catalog` (fail-soft). The content is only used
  // on a cache miss, but reading it here (a small index file) keeps the catalog
  // access to one race-free handle.
  let catalogContent: string;
  let catalogMtimeMs: number;
  try {
    const fd = openSync(config.catalog.path, "r");
    try {
      catalogMtimeMs = fstatSync(fd).mtimeMs;
      catalogContent = readFileSync(fd, "utf8");
    } finally {
      closeSync(fd);
    }
  } catch {
    logEntry(config, baseLog(input.prompt, "no_catalog"));
    return EMPTY;
  }

  // Provider-aware key gate: local providers (Ollama) need no API key.
  const needsKey = config.provider.type !== "ollama";
  const apiKey = config.provider.apiKeyEnv ? env[config.provider.apiKeyEnv] : undefined;
  if (needsKey && !apiKey) {
    logEntry(config, baseLog(input.prompt, "no_api_key"));
    return EMPTY;
  }

  const cache = new LocalCache(config.cache.dir, config.cache.ttlMin, config.cache.evictionDays);
  const cacheKey = config.cache.enabled
    ? cache.key({
        prompt: input.prompt,
        catalogMtimeMs,
        cwd,
        scriptVersion: config.scriptVersion,
        provider: `${config.provider.type}:${config.provider.model}`,
      })
    : "";

  let selectedJson = "";
  let fromCache = false;
  let usage = {
    inputTokens: 0,
    outputTokens: 0,
    cacheCreateTokens: 0,
    cacheReadTokens: 0,
  };
  let latencyMs = 0;

  if (config.cache.enabled) {
    const hit = cache.get(cacheKey);
    // Only trust a cache entry that still parses to a string array; a corrupted
    // entry is treated as a miss (we re-fetch) rather than killing the turn.
    if (hit !== null && parseBasenames(hit) !== null) {
      selectedJson = hit;
      fromCache = true;
    }
  }

  if (!fromCache) {
    const systemPrompt = buildSystemPrompt(catalogContent);
    // Provider construction can throw on bad config; the constructor `throw`s
    // are reachable from the hook, so they MUST be caught here (fail-soft).
    let provider;
    try {
      provider = createProvider(config, apiKey);
    } catch {
      logEntry(config, baseLog(input.prompt, "provider_init_failed"));
      return EMPTY;
    }
    let resp;
    try {
      resp = await provider.select({
        systemPrompt,
        userPrompt: input.prompt,
        maxOutputTokens: config.selection.maxOutputTokens,
        timeoutMs: config.selection.curlTimeoutMs,
      });
    } catch {
      logEntry(config, baseLog(input.prompt, "api_no_response"));
      return EMPTY;
    }
    latencyMs = resp.latencyMs;
    usage = resp.usage;
    if (!resp.rawText) {
      logEntry(config, {
        ...baseLog(input.prompt, "api_no_content"),
        latencyMs,
        tokensIn: usage.inputTokens,
        tokensOut: usage.outputTokens,
        cacheCreate: usage.cacheCreateTokens,
        cacheRead: usage.cacheReadTokens,
      });
      return EMPTY;
    }
    const extracted = extractJsonArray(resp.rawText);
    if (extracted === null) {
      logEntry(config, {
        ...baseLog(input.prompt, "parse_invalid"),
        latencyMs,
        tokensIn: usage.inputTokens,
        tokensOut: usage.outputTokens,
        cacheCreate: usage.cacheCreateTokens,
        cacheRead: usage.cacheReadTokens,
      });
      return EMPTY;
    }
    selectedJson = JSON.stringify(extracted);
    if (config.cache.enabled && selectedJson !== "[]") {
      cache.put(cacheKey, selectedJson);
    }
  }

  // selectedJson is a validated cache entry or a fresh `JSON.stringify` of a
  // string array, so this parse is safe by construction; `?? []` is a final
  // fail-soft backstop that never lets a malformed value throw out of route().
  const basenames = parseBasenames(selectedJson) ?? [];
  const { additional, injected, allBasenames } = readSelected(basenames, cwd, config);

  let status: string;
  if (fromCache && injected > 0) status = "cache_hit";
  else if (injected > 0) status = "ok";
  else if (selectedJson === "[]") status = "empty_selection";
  else status = "all_unfound";

  logEntry(config, {
    ts: nowIso(),
    promptPreview: input.prompt.slice(0, 80),
    selected: allBasenames,
    latencyMs,
    tokensIn: usage.inputTokens,
    tokensOut: usage.outputTokens,
    cacheCreate: usage.cacheCreateTokens,
    cacheRead: usage.cacheReadTokens,
    additionalSizeChars: additional.length,
    additionalSizeTokensEst: Math.floor(additional.length / 4),
    status,
  });

  const output: HookOutput = {
    hookSpecificOutput: {
      hookEventName: "UserPromptSubmit",
      additionalContext: additional,
    },
  };
  // Proactive `/curate` nudge — best-effort, local-only, never affects the
  // additionalContext contract or fail-soft. `catalogContent` is already in hand
  // (read above), so the catalog-size signal is free.
  const nudge = maybeCurateNudge(config, catalogContent, Date.now());
  if (nudge) output.systemMessage = nudge;
  return output;
}

function buildSystemPrompt(catalog: string): string {
  return `Tu es un sélecteur de mémoire pour Claude Code. Tu identifies les feedbacks et règles pertinents pour le prompt utilisateur. Tu réponds UNIQUEMENT avec un JSON array de basenames .md, sans explication, sans markdown code fence.

Voici les memory feedbacks + rules disponibles (sections par type, sous-sections par repo, [CWD] = repo courant à prioriser) :

${catalog}

Sélectionne 0 à 5 fichiers (basenames .md) dont le contenu sera DIRECTEMENT pertinent pour la demande utilisateur qui suit.

Critères :
- Feedback comportemental qui matche l'action (git, crypto, design, commit, etc.)
- Rule globale qui contraint la zone touchée
- Project memory qui décrit une décision déjà prise
- Memory ou rule du repo CWD (marqué [CWD]) — prioriser en cas de collision basename cross-repo

RÈGLES STRICTES POUR LES BASENAMES :
1. Copie le basename EXACT tel qu'il apparaît dans le catalog (avec préfixe \`feedback_\` ou \`project_\` si présent)
2. NE substitue PAS \`_\` par \`-\` ou inverse — les rules sont en kebab-case (\`crypto-standards.md\`), les memory en snake_case (\`feedback_X.md\`)
3. NE tronque PAS le préfixe : \`feedback_commit_without_asking.md\` reste avec son préfixe
4. N'invente JAMAIS un basename absent du catalog

Format réponse : JSON array de basenames sur UNE SEULE LIGNE.
Exemple correct : ["feedback_commit_without_asking.md", "crypto-standards.md"]
Si rien n'est pertinent : []
Pas d'explication, pas de markdown code fence.`;
}

/** Strictly parse a JSON string into a string array, or null if it isn't one. */
function parseBasenames(raw: string): string[] | null {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return null;
    return parsed.filter((x): x is string => typeof x === "string");
  } catch {
    return null;
  }
}

function extractJsonArray(text: string): string[] | null {
  const flat = text.replace(/\n/g, " ");
  const matches = flat.match(/\[[^\]]*\]/g);
  if (!matches) return null;
  // A compliant response is a single bare array, but a model may wrap it in
  // prose containing a decoy `[...]`. Scan every bracketed candidate and prefer
  // the LAST one that yields usable string basenames; keep an empty array only
  // as a fallback when no non-empty array is found, else null.
  let result: string[] | null = null;
  for (const candidate of matches) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(candidate);
    } catch {
      continue;
    }
    if (!Array.isArray(parsed)) continue;
    const strings = parsed.filter((x): x is string => typeof x === "string");
    if (strings.length > 0 || result === null) result = strings;
  }
  return result;
}

interface ReadSelectedResult {
  additional: string;
  injected: number;
  allBasenames: string[];
}

function readSelected(basenames: string[], cwd: string, config: MemhookConfig): ReadSelectedResult {
  // Build search dirs: ~/.claude/projects/*/memory + global rules + cwd rules.
  const projectDirs = listProjectsMemoryDirs(config.searchDirs[0]);
  const rulesDir = config.searchDirs[1];
  const cwdRulesDir = join(cwd, ".claude", "rules");
  const dirs = [...projectDirs, rulesDir, cwdRulesDir].filter(
    (d): d is string => typeof d === "string" && d.length > 0,
  );

  let additional = "";
  let injected = 0;
  const seen: string[] = [];
  const seenNames = new Set<string>();

  for (const name of basenames) {
    if (injected >= config.selection.maxFiles) break;
    if (!SAFE_BASENAME_RE.test(name)) continue;
    // De-dup: a basename the model repeats is injected once and uses one slot.
    if (seenNames.has(name)) continue;
    seenNames.add(name);
    seen.push(name);

    for (const dir of dirs) {
      const file = join(dir, name);

      // Read directly and treat a read failure as "not in this dir" — no
      // existsSync precheck, so no check-then-use race (CodeQL js/file-system-race).
      let content: string;
      try {
        content = readFileSync(file, "utf8");
      } catch {
        continue;
      }

      // Cap-A1 projection check — pre-injection, allow ≥1 file always.
      const projected = additional.length + content.length + 64;
      if (injected > 0 && projected > config.selection.maxAdditionalChars) {
        return { additional, injected, allBasenames: seen };
      }
      additional += `\n\n<!-- ${name} (from ${basename(dir)}) -->\n${content}`;
      injected++;
      break;
    }
  }
  return { additional, injected, allBasenames: seen };
}

function listProjectsMemoryDirs(projectsRoot: string | undefined): string[] {
  if (!projectsRoot) return [];
  let entries: string[] = [];
  try {
    entries = readdirSync(projectsRoot);
  } catch {
    return [];
  }
  const out: string[] = [];
  for (const e of entries) {
    const mem = join(projectsRoot, e, "memory");
    if (existsSync(mem)) out.push(mem);
  }
  return out;
}

function ensureDirs(config: MemhookConfig): void {
  mkdirSync(dirname(config.logging.jsonlPath), { recursive: true });
  mkdirSync(config.cache.dir, { recursive: true });
}

function evictStale(config: MemhookConfig): void {
  if (!config.cache.enabled) return;
  try {
    const cache = new LocalCache(config.cache.dir, config.cache.ttlMin, config.cache.evictionDays);
    cache.evictStale();
  } catch {
    // silent — eviction is best-effort
  }
}

/**
 * Proactive `/curate` nudge. Returns a one-line `systemMessage` when the memory
 * catalog has grown past a threshold and the cooldown has elapsed, else
 * undefined. Local-only: it reads the already-loaded catalog length, counts
 * memory files, and stamps a local cooldown file — NO outbound call. The whole
 * body is wrapped so any failure yields no nudge (fail-soft is never affected).
 *
 * Cost: within the cooldown it pays one tiny stamp read and returns; only once
 * the cooldown elapses does it count files (a readdir per memory dir, the same
 * order of I/O the router already does in `readSelected`).
 *
 * Exported for direct unit testing.
 */
export function maybeCurateNudge(
  config: MemhookConfig,
  catalogContent: string,
  now: number,
): string | undefined {
  try {
    if (!config.curateNudge.enabled) return undefined;
    const stampFile = join(config.cache.dir, ".curate-nudge");
    const last = readNudgeStamp(stampFile);
    if (last !== null && now - last < config.curateNudge.cooldownDays * 86_400_000) {
      return undefined;
    }
    const tokensEst = Math.floor(catalogContent.length / 4);
    const fileCount = countMemoryFiles(config.searchDirs[0]);
    const over =
      tokensEst >= config.curateNudge.thresholdTokens ||
      fileCount >= config.curateNudge.thresholdFiles;
    if (!over) return undefined;

    writeNudgeStamp(stampFile, now);
    const tokK = tokensEst >= 10_000 ? Math.round(tokensEst / 1000) : (tokensEst / 1000).toFixed(1);
    return `📚 memhook: memory catalog is large (~${tokK}k tokens, ${fileCount} files). Run /curate to prune duplicate and stale entries.`;
  } catch {
    return undefined; // a nudge must never break fail-soft
  }
}

/** Count top-level `*.md` memory files (excludes MEMORY.md and the journal/ subdir). */
function countMemoryFiles(projectsRoot: string | undefined): number {
  let total = 0;
  for (const dir of listProjectsMemoryDirs(projectsRoot)) {
    let entries: string[] = [];
    try {
      entries = readdirSync(dir);
    } catch {
      continue;
    }
    for (const e of entries) {
      if (e.endsWith(".md") && e !== "MEMORY.md") total++;
    }
  }
  return total;
}

function readNudgeStamp(file: string): number | null {
  try {
    const n = Number(readFileSync(file, "utf8").trim());
    return Number.isFinite(n) ? n : null;
  } catch {
    return null;
  }
}

function writeNudgeStamp(file: string, now: number): void {
  try {
    writeFileSync(file, String(now), "utf8");
  } catch {
    // best-effort — a missed stamp just means the nudge may repeat
  }
}

function baseLog(prompt: string, status: string): LogEntry {
  return {
    ts: nowIso(),
    promptPreview: prompt.slice(0, 80),
    selected: [],
    latencyMs: 0,
    tokensIn: 0,
    tokensOut: 0,
    cacheCreate: 0,
    cacheRead: 0,
    additionalSizeChars: 0,
    additionalSizeTokensEst: 0,
    status,
  };
}

function logEntry(config: MemhookConfig, entry: LogEntry): void {
  try {
    const line = JSON.stringify({
      ts: entry.ts,
      prompt_preview: entry.promptPreview,
      selected: entry.selected,
      latency_ms: entry.latencyMs,
      tokens_in: entry.tokensIn,
      tokens_out: entry.tokensOut,
      cache_create: entry.cacheCreate,
      cache_read: entry.cacheRead,
      additional_size_chars: entry.additionalSizeChars,
      additional_size_tokens_est: entry.additionalSizeTokensEst,
      status: entry.status,
      // Additive field (v0.3) — the model that handled this turn. Read by
      // `memhook tail`. The frozen log schema permits adding fields; never
      // rename/remove existing ones (docs/SPECIFICATION.md §14).
      model: config.provider.model,
    });
    appendFileSync(config.logging.jsonlPath, line + "\n", "utf8");
  } catch {
    // silent — logging is best-effort, never block hook
  }
}

function nowIso(): string {
  return new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
}
