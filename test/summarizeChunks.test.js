import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { summarizeChunks } from "../src/map/summarizeChunks.js";

async function makeTempOutputDir(t) {
  const dir = await mkdtemp(path.join(tmpdir(), "resumidor-map-test-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return dir;
}

function fakeClient(responses) {
  const calls = [];
  return {
    calls,
    client: {
      chat: {
        completions: {
          create: async (params) => {
            calls.push(params);
            const content = responses[calls.length - 1] ?? "SEM CONTEÚDO RELEVANTE";
            return { choices: [{ message: { content } }] };
          },
        },
      },
    },
  };
}

test("chama o client pra cada chunk e grava o resultado em disco", async (t) => {
  const outputDir = await makeTempOutputDir(t);
  const cfg = { outputDir, mapModel: "modelo-fake", mapConcurrency: 2 };
  const { client, calls } = fakeClient(["resumo do bloco 0", "resumo do bloco 1"]);

  const chunks = [
    { text: "[00:00:00] conteúdo do bloco 0", startTime: 0, endTime: 10 },
    { text: "[00:00:10] conteúdo do bloco 1", startTime: 10, endTime: 20 },
  ];

  const results = await summarizeChunks(chunks, "video1", cfg, client);

  assert.equal(calls.length, 2);
  assert.deepEqual(results, [
    { index: 0, startTime: 0, endTime: 10, summary: "resumo do bloco 0" },
    { index: 1, startTime: 10, endTime: 20, summary: "resumo do bloco 1" },
  ]);

  const savedChunk0 = JSON.parse(
    await readFile(path.join(outputDir, "video1", "chunks", "chunk-000.json"), "utf8")
  );
  assert.deepEqual(savedChunk0, results[0]);
});

test("monta a mensagem com o modelo configurado e o texto do chunk", async (t) => {
  const outputDir = await makeTempOutputDir(t);
  const cfg = { outputDir, mapModel: "modelo-fake", mapConcurrency: 1 };
  const { client, calls } = fakeClient(["resumo"]);

  const chunk = { text: "[00:00:00] texto do bloco", startTime: 0, endTime: 5 };
  await summarizeChunks([chunk], "video1", cfg, client);

  assert.equal(calls[0].model, "modelo-fake");
  assert.equal(calls[0].messages[0].role, "system");
  assert.match(calls[0].messages[0].content, /SEM CONTEÚDO RELEVANTE/);
  assert.deepEqual(calls[0].messages[1], { role: "user", content: chunk.text });
});

test("não chama o client de novo para um chunk já processado (retomada)", async (t) => {
  const outputDir = await makeTempOutputDir(t);
  const cfg = { outputDir, mapModel: "modelo-fake", mapConcurrency: 2 };
  const { client, calls } = fakeClient(["resumo do bloco 1"]);

  const chunksDir = path.join(outputDir, "video1", "chunks");
  await mkdir(chunksDir, { recursive: true });
  const cachedResult = { index: 0, startTime: 0, endTime: 10, summary: "já processado antes" };
  await writeFile(
    path.join(chunksDir, "chunk-000.json"),
    JSON.stringify(cachedResult, null, 2),
    "utf8"
  );

  const chunks = [
    { text: "bloco 0", startTime: 0, endTime: 10 },
    { text: "bloco 1", startTime: 10, endTime: 20 },
  ];

  const results = await summarizeChunks(chunks, "video1", cfg, client);

  assert.equal(calls.length, 1);
  assert.deepEqual(results[0], cachedResult);
  assert.equal(results[1].summary, "resumo do bloco 1");
});

test("respeita o limite de concorrência configurado", async (t) => {
  const outputDir = await makeTempOutputDir(t);
  const cfg = { outputDir, mapModel: "modelo-fake", mapConcurrency: 2 };

  let active = 0;
  let maxActive = 0;
  const client = {
    chat: {
      completions: {
        create: async () => {
          active += 1;
          maxActive = Math.max(maxActive, active);
          await new Promise((resolve) => setTimeout(resolve, 15));
          active -= 1;
          return { choices: [{ message: { content: "ok" } }] };
        },
      },
    },
  };

  const chunks = Array.from({ length: 6 }, (_, i) => ({
    text: `bloco ${i}`,
    startTime: i,
    endTime: i + 1,
  }));

  await summarizeChunks(chunks, "video1", cfg, client);

  assert.ok(maxActive <= 2, `esperado no máximo 2 chamadas simultâneas, teve ${maxActive}`);
  assert.ok(maxActive >= 1);
});
