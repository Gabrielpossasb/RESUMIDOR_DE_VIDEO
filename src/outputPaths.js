import { readdir } from "node:fs/promises";
import path from "node:path";

const COMBINING_MARKS_START = 0x0300;
const COMBINING_MARKS_END = 0x036f;
const COMBINING_MARKS = new RegExp(
  `[${String.fromCharCode(COMBINING_MARKS_START)}-${String.fromCharCode(COMBINING_MARKS_END)}]`,
  "g"
);

export function slugify(text) {
  return text
    .normalize("NFD")
    .replace(COMBINING_MARKS, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)
    .replace(/-+$/g, "");
}

export function buildVideoDirName(videoId, title) {
  const slug = title ? slugify(title) : "";
  return slug ? `${slug}-${videoId}` : videoId;
}

export async function resolveVideoDir(videoId, cfg) {
  let entries;
  try {
    entries = await readdir(cfg.outputDir, { withFileTypes: true });
  } catch (err) {
    if (err.code === "ENOENT") return null;
    throw err;
  }

  const match = entries.find(
    (entry) =>
      entry.isDirectory() &&
      (entry.name === videoId || entry.name.endsWith(`-${videoId}`))
  );

  return match ? path.join(cfg.outputDir, match.name) : null;
}

export async function videoDirOrFallback(videoId, cfg) {
  const existing = await resolveVideoDir(videoId, cfg);
  return existing ?? path.join(cfg.outputDir, videoId);
}
