import test from "node:test";
import assert from "node:assert/strict";
import { filterOverlayPids } from "../overlay/petdex.mjs";

const MINE = "C:\\Users\\dev\\.petdex\\overlay\\petdex_overlay.py";
const OTHER = "C:\\Users\\dev\\petdex-testbed\\overlay\\petdex_overlay.py";

function row(pid, script, extra = "") {
  return { ProcessId: pid, CommandLine: `"C:\\Python312\\pythonw.exe" "${script}"${extra}` };
}

test("only processes running this install are claimed", () => {
  const rows = [row(100, MINE), row(200, OTHER)];
  assert.deepEqual(filterOverlayPids(rows, MINE), [100]);
});

test("command lines are compared after normalizing slashes and case", () => {
  const rows = [
    {
      ProcessId: 7,
      CommandLine: '"C:/Python312/pythonw.exe" "c:/users/dev/.petdex/overlay/petdex_overlay.py"',
    },
  ];
  assert.deepEqual(filterOverlayPids(rows, MINE), [7]);
});

test("a single PowerShell object is accepted", () => {
  assert.deepEqual(filterOverlayPids(row(42, MINE), MINE), [42]);
});

test("rows without a command line are skipped", () => {
  const rows = [{ ProcessId: 1 }, { ProcessId: 2, CommandLine: null }, row(3, MINE)];
  assert.deepEqual(filterOverlayPids(rows, MINE), [3]);
  assert.deepEqual(filterOverlayPids([], MINE), []);
  assert.deepEqual(filterOverlayPids(null, MINE), []);
});
