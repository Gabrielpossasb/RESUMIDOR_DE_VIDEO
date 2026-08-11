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

export function chunkTranscript(segments, { chunkSizeWords, chunkOverlapWords }) {
  const words = buildWordList(segments);
  if (words.length === 0) return [];

  const step = Math.max(1, chunkSizeWords - chunkOverlapWords);
  const chunks = [];

  for (let start = 0; start < words.length; start += step) {
    const end = Math.min(start + chunkSizeWords, words.length);
    const slice = words.slice(start, end);

    chunks.push({
      text: slice.map((entry) => entry.word).join(" "),
      startTime: slice[0].startTime,
      endTime: slice[slice.length - 1].endTime,
    });

    if (end === words.length) break;
  }

  return chunks;
}
