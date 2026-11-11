import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  CODEX_EVENTS,
  isPetdexCodexCommand,
  mergeCodexHooks,
  removeCodexHooks,
} from "../tools/codex-hooks.mjs";

const repo = new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
const BASE = '"C:\\Program Files\\nodejs\\node.exe" "C:\\Users\\me\\.petdex\\overlay\\bridge.mjs" codex';

test("fragment matches the Codex event table", () => {
  const fragment = JSON.parse(
    readFileSync(join(repo, "integrations", "codex", "hooks.json.fragment"), "utf8"),
  );
  assert.deepEqual(
    Object.keys(fragment.hooks),
    CODEX_EVENTS.map((spec) => spec.name),
  );
  for (const spec of CODEX_EVENTS) {
    const hook = fragment.hooks[spec.name][0].hooks[0];
    assert.equal(hook.type, "command");
    assert.equal(hook.timeout, spec.timeout);
    assert.equal(hook.command, `PLACEHOLDER codex ${spec.event}`);
    if (spec.name === "SessionEnd" || spec.name === "Interrupt") {
      assert.ok(hook.timeout <= 3);
    }
  }
});

test("merge keeps foreign hooks and replaces our own", () => {
  const existing = {
    hooks: {
      PreToolUse: [
        {
          matcher: "^Bash$",
          hooks: [{ type: "command", command: "python3 policy.py", timeout: 30 }],
        },
        {
          hooks: [{ type: "command", command: `${BASE} pre`, timeout: 10 }],
        },
      ],
    },
  };

  const merged = mergeCodexHooks(existing, BASE);
  const pre = merged.hooks.PreToolUse;
  assert.equal(pre.length, 2);
  assert.equal(pre[0].matcher, "^Bash$");
  assert.equal(pre[0].hooks[0].command, "python3 policy.py");
  assert.equal(pre[1].hooks[0].command, `${BASE} pre`);
  assert.equal(merged.hooks.UserPromptSubmit[0].hooks[0].command, `${BASE} user-prompt`);
  assert.equal(merged.hooks.PermissionRequest[0].hooks[0].command, `${BASE} notification`);

  const again = mergeCodexHooks(merged, BASE);
  assert.equal(again.hooks.PreToolUse.length, 2);
  assert.equal(
    again.hooks.Stop.filter((group) =>
      group.hooks.some((hook) => isPetdexCodexCommand(hook.command)),
    ).length,
    1,
  );
});

test("remove drops only petdex codex commands", () => {
  const merged = mergeCodexHooks(
    {
      hooks: {
        Stop: [
          {
            hooks: [
              { type: "command", command: "python3 notes.py", timeout: 30 },
              { type: "command", command: `${BASE} stop`, timeout: 15 },
            ],
          },
        ],
      },
    },
    BASE,
  );
  const removed = removeCodexHooks(merged);
  assert.equal(removed.hooks.Stop.length, 1);
  assert.equal(removed.hooks.Stop[0].hooks.length, 1);
  assert.equal(removed.hooks.Stop[0].hooks[0].command, "python3 notes.py");
  assert.equal(removed.hooks.UserPromptSubmit, undefined);
  assert.equal(removed.hooks.SessionStart, undefined);
});
