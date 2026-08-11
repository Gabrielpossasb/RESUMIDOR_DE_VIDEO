import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import youtubedl from "youtube-dl-exec";
import { config } from "../config.js";
import { buildVideoDirName, resolveVideoDir } from "../outputPaths.js";

const PREFERRED_LANGUAGES = ["pt", "pt-BR", "pt-PT", "en", "en-US", "en-GB"];

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

async function fetchVideoInfo(videoId) {
  const url = `https://www.youtube.com/watch?v=${videoId}`;
  const info = await youtubedl(url, {
    dumpSingleJson: true,
    skipDownload: true,
    noWarnings: true,
  });

  const manualLangs = Object.keys(info.subtitles ?? {});
  const autoLangs = Object.keys(info.automatic_captions ?? {});

  const manualLang = pickLanguage(manualLangs);
  const autoLang = pickLanguage(autoLangs);

  const source = manualLang
    ? { lang: manualLang, auto: false }
    : autoLang
      ? { lang: autoLang, auto: true }
      : null;

  return {
    source,
    title: info.title ?? videoId,
    url: info.webpage_url ?? url,
  };
}

export async function readCachedTranscript(videoId) {
  const dir =
    (await resolveVideoDir(videoId, config)) ??
    path.join(config.outputDir, videoId);
  const filePath = path.join(dir, "transcript-raw.txt");

  const cached = await readCachedSegments(filePath);
  if (!cached) {
    throw new Error(
      `--skip-fetch foi usado mas não há transcrição em cache para "${videoId}" (${filePath}).`
    );
  }
  return cached;
}

export async function fetchTranscript(videoId) {
  const existingDir = await resolveVideoDir(videoId, config);

  if (existingDir) {
    const cached = await readCachedSegments(
      path.join(existingDir, "transcript-raw.txt")
    );
    if (cached) return cached;
  }

  let info;
  try {
    info = await fetchVideoInfo(videoId);
  } catch (err) {
    throw new Error(
      `Não foi possível carregar o vídeo "${videoId}": ${err.message}`
    );
  }

  if (!info.source) {
    throw new Error(
      `O vídeo "${videoId}" não possui transcrição/legendas disponíveis.`
    );
  }

  const dirName = existingDir
    ? path.basename(existingDir)
    : buildVideoDirName(videoId, info.title);
  const dir = path.join(config.outputDir, dirName);
  await mkdir(dir, { recursive: true });

  try {
    await youtubedl(info.url, {
      skipDownload: true,
      writeSub: !info.source.auto,
      writeAutoSub: info.source.auto,
      subLangs: info.source.lang,
      subFormat: "json3",
      output: path.join(dir, "%(id)s.%(ext)s"),
      noWarnings: true,
    });
  } catch (err) {
    throw new Error(
      `Falha ao baixar a legenda do vídeo "${videoId}" via yt-dlp: ${err.message}`
    );
  }

  const subtitlePath = path.join(dir, `${videoId}.${info.source.lang}.json3`);
  const body = await readFile(subtitlePath, "utf8");
  const segments = parseJson3Captions(body);
  await rm(subtitlePath, { force: true });

  if (segments.length === 0) {
    throw new Error(
      `O vídeo "${videoId}" não possui transcrição/legendas disponíveis.`
    );
  }

  await writeFile(
    path.join(dir, "transcript-raw.txt"),
    JSON.stringify(segments, null, 2),
    "utf8"
  );
  await writeFile(
    path.join(dir, "meta.json"),
    JSON.stringify({ videoId, title: info.title, url: info.url }, null, 2),
    "utf8"
  );

  return segments;
}
