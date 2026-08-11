import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { Innertube } from "youtubei.js";
import { config } from "../config.js";

function transcriptPath(videoId) {
  return path.join(config.outputDir, videoId, "transcript-raw.txt");
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

function extractSegments(transcriptInfo) {
  const nodes = transcriptInfo?.transcript?.content?.body?.initial_segments ?? [];

  return nodes
    .filter((node) => node.type === "TranscriptSegment")
    .map((node) => ({
      startTime: Number(node.start_ms) / 1000,
      endTime: Number(node.end_ms) / 1000,
      text: node.snippet.toString().trim(),
    }))
    .filter((segment) => segment.text !== "");
}

export async function fetchTranscript(videoId) {
  const filePath = transcriptPath(videoId);

  const cached = await readCachedSegments(filePath);
  if (cached) return cached;

  const youtube = await Innertube.create();

  let info;
  try {
    info = await youtube.getInfo(videoId);
  } catch (err) {
    throw new Error(
      `Não foi possível carregar o vídeo "${videoId}": ${err.message}`
    );
  }

  let transcriptInfo;
  try {
    transcriptInfo = await info.getTranscript();
  } catch {
    throw new Error(
      `O vídeo "${videoId}" não possui transcrição/legendas disponíveis.`
    );
  }

  const segments = extractSegments(transcriptInfo);
  if (segments.length === 0) {
    throw new Error(
      `O vídeo "${videoId}" não possui transcrição/legendas disponíveis.`
    );
  }

  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, JSON.stringify(segments, null, 2), "utf8");

  return segments;
}
