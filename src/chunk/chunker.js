import { formatTimestamp } from "./timestamp.js";

const MARKER_INTERVAL_WORDS = 100;

function buildWordList(segments) {
  const words = [];

  for (const segment of segments) {
    const segmentWords = segment.text.split(/\s+/).filter(Boolean);
    for (const word of segmentWords) {
      words.push({ word, startTime: segment.startTime, endTime: segment.endTime });
    }
  }

  return words;
}

function buildChunkText(slice) {
  const parts = [];
  let wordsSinceMarker = MARKER_INTERVAL_WORDS;

  for (const entry of slice) {
    if (wordsSinceMarker >= MARKER_INTERVAL_WORDS) {
      parts.push(`[${formatTimestamp(entry.startTime)}]`);
      wordsSinceMarker = 0;
    }
    parts.push(entry.word);
    wordsSinceMarker += 1;
  }

  return parts.join(" ");
}

export function chunkTranscript(segments, { chunkSizeWords, chunkOverlapWords }) {
  const words = buildWordList(segments);
  if (words.length === 0) return [];

  const step = Math.max(1, chunkSizeWords - chunkOverlapWords);
  const chunks = [];

  for (let start = 0; start < words.length; start += step) {
    const end = Math.min(start + chunkSizeWords, words.length);
    const slice = words.slice(start, end);

    chunks.push({
      text: buildChunkText(slice),
      startTime: slice[0].startTime,
      endTime: slice[slice.length - 1].endTime,
    });

    if (end === words.length) break;
  }

  return chunks;
}
