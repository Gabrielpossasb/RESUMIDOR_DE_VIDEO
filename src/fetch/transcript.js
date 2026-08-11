import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
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

function pickLanguage(availableLangs) {
  for (const lang of PREFERRED_LANGUAGES) {
    if (availableLangs.includes(lang)) return lang;
  }
  return availableLangs[0] ?? null;
}

async function pickCaptionSource(videoId) {
  const info = await youtubedl(`https://www.youtube.com/watch?v=${videoId}`, {
    dumpSingleJson: true,
    skipDownload: true,
    noWarnings: true,
  });

  const manualLangs = Object.keys(info.subtitles ?? {});
  const autoLangs = Object.keys(info.automatic_captions ?? {});

  const manualLang = pickLanguage(manualLangs);
  if (manualLang) return { lang: manualLang, auto: false };

  const autoLang = pickLanguage(autoLangs);
  if (autoLang) return { lang: autoLang, auto: true };

  return null;
}

export async function readCachedTranscript(videoId) {
  const cached = await readCachedSegments(transcriptPath(videoId));
  if (!cached) {
    throw new Error(
      `--skip-fetch foi usado mas não há transcrição em cache para "${videoId}" (${transcriptPath(videoId)}).`
    );
  }
  return cached;
}

export async function fetchTranscript(videoId) {
  const filePath = transcriptPath(videoId);
  const dir = transcriptDir(videoId);

  const cached = await readCachedSegments(filePath);
  if (cached) return cached;

  let source;
  try {
    source = await pickCaptionSource(videoId);
  } catch (err) {
    throw new Error(
      `Não foi possível carregar o vídeo "${videoId}": ${err.message}`
    );
  }

  if (!source) {
    throw new Error(
      `O vídeo "${videoId}" não possui transcrição/legendas disponíveis.`
    );
  }

  await mkdir(dir, { recursive: true });

  try {
    await youtubedl(`https://www.youtube.com/watch?v=${videoId}`, {
      skipDownload: true,
      writeSub: !source.auto,
      writeAutoSub: source.auto,
      subLangs: source.lang,
      subFormat: "json3",
      output: path.join(dir, "%(id)s.%(ext)s"),
      noWarnings: true,
    });
  } catch (err) {
    throw new Error(
      `Falha ao baixar a legenda do vídeo "${videoId}" via yt-dlp: ${err.message}`
    );
  }

  const subtitlePath = path.join(dir, `${videoId}.${source.lang}.json3`);
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
