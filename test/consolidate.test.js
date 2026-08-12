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

// responses: string (repetida em toda chamada) ou array (uma por chamada, na
// ordem em que as 5 seções são disparadas)
function fakeClient(responses) {
  const calls = [];
  return {
    calls,
    client: {
      chat: {
        completions: {
          create: async (params) => {
            const content = Array.isArray(responses) ? responses[calls.length] : responses;
            calls.push(params);
            return { choices: [{ message: { content } }] };
          },
        },
      },
    },
  };
}

test("faz uma chamada por seção e monta o markdown com os cabeçalhos, ignorando SEM CONTEÚDO RELEVANTE", async (t) => {
  const outputDir = await makeTempOutputDir(t);
  const cfg = { outputDir, reduceModel: "modelo-forte-fake" };
  const { client, calls } = fakeClient([
    "- teses body",
    "- conceitos body",
    "- ferramentas body",
    "- recomendações body",
    "- polêmicos body",
  ]);

  await writeChunk(outputDir, "video1", 0, "resumo relevante do bloco 0 (00:00:00)");
  await writeChunk(outputDir, "video1", 1, "SEM CONTEÚDO RELEVANTE.");
  await writeChunk(outputDir, "video1", 2, "resumo relevante do bloco 2 (00:20:00)");

  const markdown = await consolidate("video1", cfg, client);

  assert.equal(calls.length, 5);
  for (const call of calls) {
    assert.equal(call.model, "modelo-forte-fake");
    assert.match(call.messages[1].content, /bloco 0/);
    assert.match(call.messages[1].content, /bloco 2/);
    assert.doesNotMatch(call.messages[1].content, /SEM CONTEÚDO RELEVANTE/);
  }

  // sem meta.json, o cabeçalho cai pro videoId
  assert.equal(
    markdown,
    "# video1\n\n" +
      "## Teses principais defendidas\n\n- teses body\n\n" +
      "## Conceitos técnicos explicados\n\n- conceitos body\n\n" +
      "## Ferramentas e projetos mencionados\n\n- ferramentas body\n\n" +
      "## Recomendações práticas\n\n- recomendações body\n\n" +
      "## Pontos polêmicos ou contra-intuitivos\n\n- polêmicos body"
  );

  const saved = await readFile(path.join(outputDir, "video1", "resumo-final.md"), "utf8");
  assert.equal(saved, markdown);
});

test("omite seções que voltam sem conteúdo relevante", async (t) => {
  const outputDir = await makeTempOutputDir(t);
  const cfg = { outputDir, reduceModel: "modelo-forte-fake" };
  const { client } = fakeClient([
    "- teses body",
    "SEM PONTOS NESTA CATEGORIA",
    "- ferramentas body",
    "SEM PONTOS NESTA CATEGORIA.",
    "- polêmicos body",
  ]);

  await writeChunk(outputDir, "video1", 0, "resumo relevante (00:00:00)");

  const markdown = await consolidate("video1", cfg, client);

  assert.doesNotMatch(markdown, /Conceitos técnicos explicados/);
  assert.doesNotMatch(markdown, /Recomendações práticas/);
  assert.match(markdown, /Teses principais defendidas/);
  assert.match(markdown, /Ferramentas e projetos mencionados/);
  assert.match(markdown, /Pontos polêmicos ou contra-intuitivos/);
});

test("usa o título e o link do meta.json como cabeçalho, quando existem", async (t) => {
  const outputDir = await makeTempOutputDir(t);
  const cfg = { outputDir, reduceModel: "modelo-forte-fake" };
  const { client } = fakeClient("- conteúdo");

  await writeChunk(outputDir, "video1", 0, "resumo relevante (00:00:00)");
  await writeMeta(outputDir, "video1", {
    videoId: "video1",
    title: "Título Real do Vídeo",
    url: "https://www.youtube.com/watch?v=video1",
  });

  const markdown = await consolidate("video1", cfg, client);

  assert.match(
    markdown,
    /^# Título Real do Vídeo\n\n\[Assistir no YouTube\]\(https:\/\/www\.youtube\.com\/watch\?v=video1\)\n\n/
  );
});

test("reconhece variações de SEM CONTEÚDO RELEVANTE (minúsculas, com pontuação) ao montar o input", async (t) => {
  const outputDir = await makeTempOutputDir(t);
  const cfg = { outputDir, reduceModel: "modelo-forte-fake" };
  const { client, calls } = fakeClient("- ok");

  await writeChunk(outputDir, "video1", 0, "sem conteúdo relevante.");
  await writeChunk(outputDir, "video1", 1, "conteúdo de verdade aqui");

  await consolidate("video1", cfg, client);

  assert.equal(calls.length, 5);
  assert.doesNotMatch(calls[0].messages[1].content, /sem conteúdo relevante/i);
});

test("lança erro claro quando nenhum chunk tem conteúdo relevante, sem chamar o client", async (t) => {
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

test("tenta de novo quando recebe rate limit (status 429) e depois funciona", async (t) => {
  const outputDir = await makeTempOutputDir(t);
  const cfg = { outputDir, reduceModel: "modelo-forte-fake" };

  let attempts = 0;
  const client = {
    chat: {
      completions: {
        create: async () => {
          attempts += 1;
          if (attempts === 1) {
            const err = new Error("rate limit");
            err.status = 429;
            throw err;
          }
          return { choices: [{ message: { content: "- ok" } }] };
        },
      },
    },
  };

  await writeChunk(outputDir, "video1", 0, "resumo relevante (00:00:00)");

  const markdown = await consolidate("video1", cfg, client, { retryDelayMs: 5 });

  assert.match(markdown, /ok/);
  assert.ok(attempts > 5, "esperava pelo menos uma nova tentativa além das 5 seções");
});

test("desiste após esgotar as tentativas de retry e propaga o erro", async (t) => {
  const outputDir = await makeTempOutputDir(t);
  const cfg = { outputDir, reduceModel: "modelo-forte-fake" };

  const client = {
    chat: {
      completions: {
        create: async () => {
          const err = new Error("rate limit");
          err.status = 429;
          throw err;
        },
      },
    },
  };

  await writeChunk(outputDir, "video1", 0, "resumo relevante (00:00:00)");

  await assert.rejects(
    () => consolidate("video1", cfg, client, { retryDelayMs: 5 }),
    /rate limit/
  );
});

test("usa um nome de arquivo alternativo quando passado em options.fileName", async (t) => {
  const outputDir = await makeTempOutputDir(t);
  const cfg = { outputDir, reduceModel: "modelo-forte-fake" };
  const { client } = fakeClient("- conteúdo");

  await writeChunk(outputDir, "video1", 0, "resumo relevante (00:00:00)");

  await consolidate("video1", cfg, client, { fileName: "resumo-alternativo.md" });

  const saved = await readFile(
    path.join(outputDir, "video1", "resumo-alternativo.md"),
    "utf8"
  );
  assert.match(saved, /conteúdo/);

  await assert.rejects(() =>
    readFile(path.join(outputDir, "video1", "resumo-final.md"), "utf8")
  );
});
