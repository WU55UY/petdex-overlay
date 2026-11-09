/**
 * Local-text reader for the pet overlay panel.
 * Drop UTF-8/GB18030 .txt files in <PETDEX_HOME>/novel/; wheel pages, progress is remembered.
 */
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = process.env.PETDEX_HOME
  ? join(process.env.PETDEX_HOME)
  : join(homedir(), ".petdex");
const NOVEL_DIR = join(ROOT, "novel");
const PROGRESS_PATH = join(NOVEL_DIR, "progress.json");
const WRAP = 20;
const PAGE_LINES = 8;

function readJson(path, fallback) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return fallback;
  }
}

function atomicWrite(path, obj) {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(obj, null, 2), "utf8");
  renameSync(tmp, path);
}

function decodeBuffer(buf) {
  if (!buf.length) return "";
  if (buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) {
    return buf.slice(3).toString("utf8");
  }
  const utf8 = buf.toString("utf8");
  const sample = utf8.slice(0, 4000);
  const bad = (sample.match(/\uFFFD/g) || []).length;
  if (bad <= 2) return utf8;
  try {
    return new TextDecoder("gb18030").decode(buf);
  } catch {
    return utf8;
  }
}

function listNovels() {
  mkdirSync(NOVEL_DIR, { recursive: true });
  return readdirSync(NOVEL_DIR)
    .filter(
      (n) =>
        n.toLowerCase().endsWith(".txt") &&
        !n.startsWith(".") &&
        n.toLowerCase() !== "readme.txt",
    )
    .sort((a, b) => a.localeCompare(b, "zh"));
}

function wrapParagraph(p, width) {
  const out = [];
  let line = "";
  for (const ch of p.replace(/\r/g, "")) {
    if (ch === "\n") {
      out.push(line);
      line = "";
      continue;
    }
    line += ch;
    if (line.length >= width) {
      out.push(line);
      line = "";
    }
  }
  if (line) out.push(line);
  return out;
}

function wrapBook(text) {
  const paras = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
  const lines = [];
  for (const p of paras) {
    const t = p.trim();
    if (!t) {
      if (lines.length && lines[lines.length - 1] !== "") lines.push("");
      continue;
    }
    lines.push(...wrapParagraph(t, WRAP));
  }
  while (lines.length && lines[0] === "") lines.shift();
  while (lines.length && lines[lines.length - 1] === "") lines.pop();
  return lines;
}

function loadProgress() {
  const p = readJson(PROGRESS_PATH, {}) || {};
  return {
    file: typeof p.file === "string" ? p.file : "",
    line: Math.max(0, Number(p.line) || 0),
  };
}

function saveProgress(file, line) {
  atomicWrite(PROGRESS_PATH, { file, line: Math.max(0, line), at: Date.now() });
}

function pickFile(names, wanted) {
  if (wanted && names.includes(wanted)) return wanted;
  return names[0] || "";
}

function bookTitle(filename) {
  return basename(filename, ".txt") || "未命名";
}

export function formatNovelPanel(pageDelta = 0) {
  mkdirSync(NOVEL_DIR, { recursive: true });
  const names = listNovels();
  if (!names.length) {
    return [
      "还没有书",
      "把 .txt 放进",
      NOVEL_DIR,
      "单击切换 · 滚轮翻页",
    ].join("\n");
  }

  const prev = loadProgress();
  const file = pickFile(names, prev.file);
  const raw = decodeBuffer(readFileSync(join(NOVEL_DIR, file)));
  const lines = wrapBook(raw);
  const total = Math.max(1, lines.length);
  let line = prev.file === file ? prev.line : 0;
  line += (Number(pageDelta) || 0) * PAGE_LINES;
  const maxLine = Math.max(0, total - PAGE_LINES);
  line = Math.min(Math.max(0, line), maxLine);
  saveProgress(file, line);

  const page = lines.slice(line, line + PAGE_LINES);
  const body = page.length ? page : ["(完)"];
  return [...body, "单击切换 · 滚轮翻页"].join("\n");
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const d = process.argv[2] === "next" ? 1 : process.argv[2] === "prev" ? -1 : 0;
  console.log(formatNovelPanel(d));
}
