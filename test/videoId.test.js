import { test } from "node:test";
import assert from "node:assert/strict";
import { extractVideoId } from "../src/fetch/videoId.js";

test("URL padrão /watch?v=", () => {
  assert.equal(
    extractVideoId("https://www.youtube.com/watch?v=dQw4w9WgXcQ"),
    "dQw4w9WgXcQ"
  );
});

test("URL /watch?v= com parâmetros extras", () => {
  assert.equal(
    extractVideoId(
      "https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=43s&list=xyz"
    ),
    "dQw4w9WgXcQ"
  );
});

test("URL curta youtu.be", () => {
  assert.equal(extractVideoId("https://youtu.be/dQw4w9WgXcQ"), "dQw4w9WgXcQ");
});

test("URL curta youtu.be com query", () => {
  assert.equal(
    extractVideoId("https://youtu.be/dQw4w9WgXcQ?t=30"),
    "dQw4w9WgXcQ"
  );
});

test("URL de shorts", () => {
  assert.equal(
    extractVideoId("https://www.youtube.com/shorts/dQw4w9WgXcQ"),
    "dQw4w9WgXcQ"
  );
});

test("URL mobile (m.youtube.com)", () => {
  assert.equal(
    extractVideoId("https://m.youtube.com/watch?v=dQw4w9WgXcQ"),
    "dQw4w9WgXcQ"
  );
});

test("URL de embed", () => {
  assert.equal(
    extractVideoId("https://www.youtube.com/embed/dQw4w9WgXcQ"),
    "dQw4w9WgXcQ"
  );
});

test("ID puro passa direto", () => {
  assert.equal(extractVideoId("dQw4w9WgXcQ"), "dQw4w9WgXcQ");
});

test("URL de outro site lança erro", () => {
  assert.throws(() => extractVideoId("https://example.com/foo"));
});

test("string vazia lança erro", () => {
  assert.throws(() => extractVideoId(""));
});

test("lixo aleatório lança erro", () => {
  assert.throws(() => extractVideoId("nao é uma url nem um id"));
});
