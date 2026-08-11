import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { consolidate } from "../src/reduce/consolidate.js";

async function makeTempOutputDir(t) {
  const dir = await mkdtemp(path.join(tmpdir(), "resumidor-reduce-test-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return dir;
}

async function writeChunk(outputDir, videoId, index, summary) {
  const dir = path.join(outputDir, videoId, "chunks");
  await mkdir(dir, { recursive: true });
  const result = { index, startTime: index * 10, endTime: index * 10 + 10, summary };
  await writeFile(
    path.join(dir, `chunk-${String(index).padStart(3, "0")}.json`),
    JSON.stringify(result, null, 2),
    "utf8"
  );
}

async function writeMeta(outputDir, videoId, meta) {
  const dir = path.join(outputDir, videoId);
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, "meta.json"), JSON.stringify(meta, null, 2), "utf8");
}

function fakeClient(markdown) {
  const calls = [];
  return {
    calls,
    client: {
      chat: {
        completions: {
          create: async (params) => {
            calls.push(params);
            return { choices: [{ message: { content: markdown } }] };
          },
        },
      },
    },
  };
}

test("consolida os resumos relevantes numa única chamada, ignorando SEM CONTEÚDO RELEVANTE", async (t) => {
  const outputDir = await makeTempOutputDir(t);
  const cfg = { outputDir, reduceModel: "modelo-forte-fake" };
  const { client, calls } = fakeClient("# Resumo final\n\nconteúdo consolidado");

  await writeChunk(outputDir, "video1", 0, "resumo relevante do bloco 0 (00:00:00)");
  await writeChunk(outputDir, "video1", 1, "SEM CONTEÚDO RELEVANTE.");
  await writeChunk(outputDir, "video1", 2, "resumo relevante do bloco 2 (00:20:00)");

  const markdown = await consolidate("video1", cfg, client);

  assert.equal(calls.length, 1);
  assert.equal(calls[0].model, "modelo-forte-fake");
  assert.match(calls[0].messages[1].content, /bloco 0/);
  assert.match(calls[0].messages[1].content, /bloco 2/);
  assert.doesNotMatch(calls[0].messages[1].content, /SEM CONTEÚDO RELEVANTE/);

  // sem meta.json, o cabeçalho cai pro videoId
  assert.equal(markdown, "# video1\n\n# Resumo final\n\nconteúdo consolidado");

  const saved = await readFile(path.join(outputDir, "video1", "resumo-final.md"), "utf8");
  assert.equal(saved, markdown);
});

test("usa o título e o link do meta.json como cabeçalho, quando existem", async (t) => {
  const outputDir = await makeTempOutputDir(t);
  const cfg = { outputDir, reduceModel: "modelo-forte-fake" };
  const { client } = fakeClient("## Teses principais\n\nconteúdo");

  await writeChunk(outputDir, "video1", 0, "resumo relevante (00:00:00)");
  await writeMeta(outputDir, "video1", {
    videoId: "video1",
    title: "Título Real do Vídeo",
    url: "https://www.youtube.com/watch?v=video1",
  });

  const markdown = await consolidate("video1", cfg, client);

  assert.equal(
    markdown,
    "# Título Real do Vídeo\n\n[Assistir no YouTube](https://www.youtube.com/watch?v=video1)\n\n## Teses principais\n\nconteúdo"
  );
});

test("reconhece variações de SEM CONTEÚDO RELEVANTE (minúsculas, com pontuação)", async (t) => {
  const outputDir = await makeTempOutputDir(t);
  const cfg = { outputDir, reduceModel: "modelo-forte-fake" };
  const { client, calls } = fakeClient("ok");

  await writeChunk(outputDir, "video1", 0, "sem conteúdo relevante.");
  await writeChunk(outputDir, "video1", 1, "conteúdo de verdade aqui");

  await consolidate("video1", cfg, client);

  assert.equal(calls.length, 1);
  assert.doesNotMatch(calls[0].messages[1].content, /sem conteúdo relevante/i);
});

test("lança erro claro quando nenhum chunk tem conteúdo relevante", async (t) => {
  const outputDir = await makeTempOutputDir(t);
  const cfg = { outputDir, reduceModel: "modelo-forte-fake" };
  const { client, calls } = fakeClient("não devia chegar aqui");

  await writeChunk(outputDir, "video1", 0, "SEM CONTEÚDO RELEVANTE");
  await writeChunk(outputDir, "video1", 1, "SEM CONTEÚDO RELEVANTE.");

  await assert.rejects(
    () => consolidate("video1", cfg, client),
    /Nenhum conteúdo relevante/
  );
  assert.equal(calls.length, 0);
});

test("reusa resumo-final.md já existente sem chamar o client (retomada)", async (t) => {
  const outputDir = await makeTempOutputDir(t);
  const cfg = { outputDir, reduceModel: "modelo-forte-fake" };
  const { client, calls } = fakeClient("não devia chegar aqui");

  const videoDir = path.join(outputDir, "video1");
  await mkdir(videoDir, { recursive: true });
  await writeFile(path.join(videoDir, "resumo-final.md"), "# já processado", "utf8");

  const markdown = await consolidate("video1", cfg, client);

  assert.equal(markdown, "# já processado");
  assert.equal(calls.length, 0);
});
