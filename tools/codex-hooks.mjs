#!/usr/bin/env node
/**
 * Merge or remove petdex-overlay command hooks in a Codex hooks.json.
 *
 * Codex stores hooks at ~/.codex/hooks.json (or a project .codex/hooks.json).
 * Each event is an array of groups; each group has a hooks array of handlers.
 * SessionEnd and Interrupt accept at most 3 seconds.
 *
 *   node tools/codex-hooks.mjs merge <hooks.json> <command-base>
 *   node tools/codex-hooks.mjs remove <hooks.json>
 *
 * command-base is everything before the event name, for example:
 *   "C:\Program Files\nodejs\node.exe" "C:\Users\me\.petdex\overlay\bridge.mjs" codex
 */
import { readFileSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

export const CODEX_EVENTS = [
  { name: "SessionStart", event: "workspace-open", timeout: 10 },
  { name: "SessionEnd", event: "session-end", timeout: 3 },
  { name: "UserPromptSubmit", event: "user-prompt", timeout: 10 },
  { name: "PreToolUse", event: "pre", timeout: 10 },
  { name: "PostToolUse", event: "post", timeout: 10 },
  { name: "PermissionRequest", event: "notification", timeout: 5 },
  { name: "Stop", event: "stop", timeout: 15 },
  { name: "Interrupt", event: "interrupt", timeout: 3 },
];

export function isPetdexCodexCommand(command) {
  return (
    typeof command === "string" &&
    /bridge\.mjs(?:"|')?\s+codex\b/.test(command)
  );
}

function readHooks(existing) {
  if (!existing || typeof existing !== "object" || Array.isArray(existing)) {
    return { hooks: {} };
  }
  const hooks =
    existing.hooks && typeof existing.hooks === "object" && !Array.isArray(existing.hooks)
      ? existing.hooks
      : {};
  return { ...existing, hooks: { ...hooks } };
}

function withoutOurs(groups) {
  const list = Array.isArray(groups) ? groups : [];
  const cleaned = [];
  for (const group of list) {
    if (!group || typeof group !== "object") continue;
    const hooks = Array.isArray(group.hooks) ? group.hooks : [];
    const kept = hooks.filter((hook) => !isPetdexCodexCommand(hook?.command));
    if (kept.length === 0) continue;
    cleaned.push({ ...group, hooks: kept });
  }
  return cleaned;
}

export function mergeCodexHooks(existing, commandBase) {
  const base = String(commandBase || "").trim();
  if (!base) throw new Error("command base is required");
  const root = readHooks(existing);
  for (const spec of CODEX_EVENTS) {
    const cleaned = withoutOurs(root.hooks[spec.name]);
    cleaned.push({
      hooks: [
        {
          type: "command",
          command: `${base} ${spec.event}`,
          timeout: spec.timeout,
        },
      ],
    });
    root.hooks[spec.name] = cleaned;
  }
  return root;
}

export function removeCodexHooks(existing) {
  const root = readHooks(existing);
  for (const spec of CODEX_EVENTS) {
    if (!Object.prototype.hasOwnProperty.call(root.hooks, spec.name)) continue;
    const cleaned = withoutOurs(root.hooks[spec.name]);
    if (cleaned.length === 0) delete root.hooks[spec.name];
    else root.hooks[spec.name] = cleaned;
  }
  return root;
}

function readJsonFile(path) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    if (error && error.code === "ENOENT") return { hooks: {} };
    throw error;
  }
}

function main(argv) {
  const [action, path, commandBase] = argv;
  if (!path || (action !== "merge" && action !== "remove")) {
    process.stderr.write(
      "usage: node tools/codex-hooks.mjs <merge|remove> <hooks.json> [command-base]\n",
    );
    process.exit(1);
  }
  const current = readJsonFile(path);
  const next =
    action === "merge" ? mergeCodexHooks(current, commandBase) : removeCodexHooks(current);
  writeFileSync(path, `${JSON.stringify(next, null, 2)}\n`, "utf8");
}

const isMain =
  process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMain) main(process.argv.slice(2));
