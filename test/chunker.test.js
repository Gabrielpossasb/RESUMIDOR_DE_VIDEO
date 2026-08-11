import { test } from "node:test";
import assert from "node:assert/strict";
import { chunkTranscript } from "../src/chunk/chunker.js";

function wordSegments(words) {
  return words.map((word, i) => ({
    text: word,
    startTime: i,
    endTime: i + 1,
  }));
}

test("transcrição vazia gera nenhum chunk", () => {
  assert.deepEqual(chunkTranscript([], { chunkSizeWords: 5, chunkOverlapWords: 2 }), []);
});

test("transcrição menor que o chunk gera um único chunk", () => {
  const segments = [
    { text: "isso é um vídeo curto", startTime: 0, endTime: 12 },
  ];

  const chunks = chunkTranscript(segments, {
    chunkSizeWords: 5000,
    chunkOverlapWords: 200,
  });

  assert.equal(chunks.length, 1);
  assert.equal(chunks[0].text, "[00:00:00] isso é um vídeo curto");
  assert.equal(chunks[0].startTime, 0);
  assert.equal(chunks[0].endTime, 12);
});

test("transcrição longa gera múltiplos chunks com overlap", () => {
  const segments = wordSegments(["a", "b", "c", "d", "e", "f", "g", "h", "i", "j"]);

  const chunks = chunkTranscript(segments, {
    chunkSizeWords: 5,
    chunkOverlapWords: 2,
  });

  assert.equal(chunks.length, 3);

  assert.equal(chunks[0].text, "[00:00:00] a b c d e");
  assert.equal(chunks[0].startTime, 0);
  assert.equal(chunks[0].endTime, 5);

  assert.equal(chunks[1].text, "[00:00:03] d e f g h");
  assert.equal(chunks[1].startTime, 3);
  assert.equal(chunks[1].endTime, 8);

  assert.equal(chunks[2].text, "[00:00:06] g h i j");
  assert.equal(chunks[2].startTime, 6);
  assert.equal(chunks[2].endTime, 10);
});

test("último chunk não fica menor do que precisa por causa do fim exato", () => {
  const segments = wordSegments(["a", "b", "c", "d", "e", "f"]);

  const chunks = chunkTranscript(segments, {
    chunkSizeWords: 3,
    chunkOverlapWords: 0,
  });

  assert.equal(chunks.length, 2);
  assert.equal(chunks[0].text, "[00:00:00] a b c");
  assert.equal(chunks[1].text, "[00:00:03] d e f");
});

test("overlap maior ou igual ao tamanho do chunk não trava (avança pelo menos 1 palavra)", () => {
  const segments = wordSegments(["a", "b", "c", "d", "e"]);

  const chunks = chunkTranscript(segments, {
    chunkSizeWords: 3,
    chunkOverlapWords: 10,
  });

  assert.equal(chunks.length, 3);
  assert.equal(chunks[0].text, "[00:00:00] a b c");
  assert.equal(chunks[1].text, "[00:00:01] b c d");
  assert.equal(chunks[2].text, "[00:00:02] c d e");
});

test("insere marcador de timestamp a cada 100 palavras dentro de um chunk grande", () => {
  const words = Array.from({ length: 250 }, (_, i) => `w${i}`);
  const segments = wordSegments(words);

  const chunks = chunkTranscript(segments, {
    chunkSizeWords: 250,
    chunkOverlapWords: 0,
  });

  assert.equal(chunks.length, 1);

  const markers = [...chunks[0].text.matchAll(/\[(\d{2}:\d{2}:\d{2})\]/g)].map(
    (m) => m[1]
  );

  assert.deepEqual(markers, ["00:00:00", "00:01:40", "00:03:20"]);
});
