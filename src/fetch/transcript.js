import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import youtubedl from "youtube-dl-exec";
import { config } from "../config.js";

const PREFERRED_LANGUAGES = ["pt", "pt-BR", "pt-PT", "en", "en-US", "en-GB"];

function transcriptDir(videoId) {
  return path.join(config.outputDir, videoId);
}

function transcriptPath(videoId) {
  return path.join(transcriptDir(videoId), "transcript-raw.txt");
}

async function readCachedSegments(filePath) {
  try {
    const raw = await readFile(filePath, "utf8");
    return JSON.parse(raw);
  } catch (err) {
    if (err.code === "ENOENT") return null;
    throw err;
  }
}

function parseJson3Captions(body) {
  const data = JSON.parse(body);
  const events = data.events ?? [];

  return events
    .filter(
      (event) => Array.isArray(event.segs) && typeof event.tStartMs === "number"
    )
    .map((event) => {
      const text = event.segs
        .map((seg) => seg.utf8 ?? "")
        .join("")
        .replace(/\n/g, " ")
        .trim();
      const startTime = event.tStartMs / 1000;
      const endTime = startTime + (event.dDurationMs ?? 0) / 1000;
      return { startTime, endTime, text };
    })
    .filter((segment) => segment.text !== "");
}

function pickSubtitleFile(files, videoId) {
  const pattern = new RegExp(`^${videoId}\\.([^.]+)\\.json3$`);
  const candidates = files
    .map((file) => {
      const match = file.match(pattern);
      return match ? { file, lang: match[1] } : null;
    })
    .filter(Boolean);

  if (candidates.length === 0) return null;

  for (const lang of PREFERRED_LANGUAGES) {
    const found = candidates.find((c) => c.lang === lang);
    if (found) return found.file;
  }
  return candidates[0].file;
}

export async function fetchTranscript(videoId) {
  const filePath = transcriptPath(videoId);
  const dir = transcriptDir(videoId);

  const cached = await readCachedSegments(filePath);
  if (cached) return cached;

  await mkdir(dir, { recursive: true });

  try {
    await youtubedl(`https://www.youtube.com/watch?v=${videoId}`, {
      skipDownload: true,
      writeSub: true,
      writeAutoSub: true,
      subLangs: "all",
      subFormat: "json3",
      output: path.join(dir, "%(id)s.%(ext)s"),
      noWarnings: true,
    });
  } catch (err) {
    throw new Error(
      `Falha ao baixar a legenda do vídeo "${videoId}" via yt-dlp: ${err.message}`
    );
  }

  const files = await readdir(dir);
  const subtitleFile = pickSubtitleFile(files, videoId);

  if (!subtitleFile) {
    throw new Error(
      `O vídeo "${videoId}" não possui transcrição/legendas disponíveis.`
    );
  }

  const subtitlePath = path.join(dir, subtitleFile);
  const body = await readFile(subtitlePath, "utf8");
  const segments = parseJson3Captions(body);
  await rm(subtitlePath, { force: true });

  if (segments.length === 0) {
    throw new Error(
      `O vídeo "${videoId}" não possui transcrição/legendas disponíveis.`
    );
  }

  await writeFile(filePath, JSON.stringify(segments, null, 2), "utf8");

  return segments;
}
