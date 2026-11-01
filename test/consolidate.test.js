import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { consolidate, reduceCallCount } from "../src/reduce/consolidate.js";

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

function outlineJson(topics) {
  return JSON.stringify({ topicos: topics });
}

// responses[0] é a resposta do roteiro; as seguintes, uma por tópico. Quando
// acabam, a última é repetida.
function fakeClient(responses) {
  const list = Array.isArray(responses) ? responses : [responses];
  const calls = [];
  return {
    calls,
    client: {
      chat: {
        completions: {
          create: async (params) => {
            const content = list[Math.min(calls.length, list.length - 1)];
            calls.push(params);
            return { choices: [{ message: { content } }] };
          },
        },
      },
    },
  };
}

const TWO_TOPICS = outlineJson([
  {
    titulo: "Produção e gestão de requisitos",
    inicio: "00:01:37",
    fim: "00:06:00",
    resumo: "Parágrafo de visão geral do primeiro tópico.",
  },
  {
    titulo: "Requisitos em métodos ágeis",
    inicio: "00:06:01",
    fim: "00:20:00",
    resumo: "Parágrafo de visão geral do segundo tópico.",
  },
]);

test("faz uma chamada de roteiro e uma por tópico, montando visão geral e seções", async (t) => {
  const outputDir = await makeTempOutputDir(t);
  const cfg = { outputDir, reduceModel: "modelo-forte-fake" };
  const { client, calls } = fakeClient([
    TWO_TOPICS,
    "Texto corrido do primeiro tópico.\n\nTimestamps: 00:01:37, 00:04:10",
    "Texto corrido do segundo tópico.\n\nTimestamps: 00:06:01, 00:12:00",
  ]);

  await writeChunk(outputDir, "video1", 0, "resumo relevante do bloco 0 (00:00:00)");
  await writeChunk(outputDir, "video1", 1, "SEM CONTEÚDO RELEVANTE.");
  await writeChunk(outputDir, "video1", 2, "resumo relevante do bloco 2 (00:20:00)");

  const markdown = await consolidate("video1", cfg, client);

  assert.equal(calls.length, 3); // roteiro + 2 tópicos
  for (const call of calls) {
    assert.equal(call.model, "modelo-forte-fake");
    assert.match(call.messages[1].content, /bloco 0/);
    assert.match(call.messages[1].content, /bloco 2/);
    assert.doesNotMatch(call.messages[1].content, /SEM CONTEÚDO RELEVANTE/);
  }

  // as chamadas de tópico recebem a lista completa, pra não invadir o vizinho
  assert.match(calls[1].messages[0].content, /tópico 1: "Produção e gestão de requisitos"/);
  assert.match(calls[1].messages[0].content, /2\. Requisitos em métodos ágeis/);
  assert.match(calls[2].messages[0].content, /tópico 2: "Requisitos em métodos ágeis"/);

  // sem meta.json, o cabeçalho cai pro videoId
  assert.equal(
    markdown,
    "# video1\n\n" +
      "## Visão geral\n\n" +
      "**1. Produção e gestão de requisitos** (00:01:37 – 00:06:00)\n\n" +
      "Parágrafo de visão geral do primeiro tópico.\n\n" +
      "**2. Requisitos em métodos ágeis** (00:06:01 – 00:20:00)\n\n" +
      "Parágrafo de visão geral do segundo tópico.\n\n" +
      "---\n\n" +
      "## 1. Produção e gestão de requisitos\n\n" +
      "Texto corrido do primeiro tópico.\n\n*Timestamps: 00:01:37, 00:04:10*\n\n" +
      "## 2. Requisitos em métodos ágeis\n\n" +
      "Texto corrido do segundo tópico.\n\n*Timestamps: 00:06:01, 00:12:00*\n"
  );

  const saved = await readFile(path.join(outputDir, "video1", "resumo-final.md"), "utf8");
  assert.equal(saved, markdown);
});

test("aceita o roteiro embrulhado em bloco de código", async (t) => {
  const outputDir = await makeTempOutputDir(t);
  const cfg = { outputDir, reduceModel: "modelo-forte-fake" };
  const { client } = fakeClient([
    "```json\n" + TWO_TOPICS + "\n```",
    "corpo do tópico",
  ]);

  await writeChunk(outputDir, "video1", 0, "resumo relevante (00:00:00)");

  const markdown = await consolidate("video1", cfg, client);

  assert.match(markdown, /## 1\. Produção e gestão de requisitos/);
  assert.match(markdown, /## 2\. Requisitos em métodos ágeis/);
});

test("normaliza a linha final de referências em itálico, mesmo com variações", async (t) => {
  const outputDir = await makeTempOutputDir(t);
  const cfg = { outputDir, reduceModel: "modelo-forte-fake" };
  const { client } = fakeClient([
    outlineJson([{ titulo: "Tópico único", inicio: "00:00:10", fim: "00:00:10", resumo: "r" }]),
    "Parágrafo explicando.\n**Fontes: 00:00:10, 00:05:00**",
  ]);

  await writeChunk(outputDir, "video1", 0, "resumo relevante (00:00:00)");

  const markdown = await consolidate("video1", cfg, client);

  assert.match(markdown, /Parágrafo explicando\.\n\n\*Timestamps: 00:00:10, 00:05:00\*/);
  // início e fim iguais viram um timestamp só na visão geral
  assert.match(markdown, /\*\*1\. Tópico único\*\* \(00:00:10\)/);
});

test("corta tópicos acima do teto configurado em reduceMaxTopics", async (t) => {
  const outputDir = await makeTempOutputDir(t);
  const cfg = { outputDir, reduceModel: "modelo-forte-fake", reduceMaxTopics: 2 };
  const { client, calls } = fakeClient([
    outlineJson(
      [1, 2, 3, 4].map((n) => ({
        titulo: `Tópico ${n}`,
        inicio: "00:00:00",
        fim: "00:10:00",
        resumo: `resumo ${n}`,
      }))
    ),
    "corpo",
  ]);

  await writeChunk(outputDir, "video1", 0, "resumo relevante (00:00:00)");

  const markdown = await consolidate("video1", cfg, client);

  assert.equal(calls.length, 3); // roteiro + 2 tópicos
  assert.match(calls[0].messages[0].content, /Entre 4 e 2 tópicos/);
  assert.match(markdown, /## 2\. Tópico 2/);
  assert.doesNotMatch(markdown, /Tópico 3/);
});

test("usa o título e o link do meta.json como cabeçalho, quando existem", async (t) => {
  const outputDir = await makeTempOutputDir(t);
  const cfg = { outputDir, reduceModel: "modelo-forte-fake" };
  const { client } = fakeClient([TWO_TOPICS, "corpo"]);

  await writeChunk(outputDir, "video1", 0, "resumo relevante (00:00:00)");
  await writeMeta(outputDir, "video1", {
    videoId: "video1",
    title: "Título Real do Vídeo",
    url: "https://www.youtube.com/watch?v=video1",
  });

  const markdown = await consolidate("video1", cfg, client);

  assert.match(
    markdown,
    /^# Título Real do Vídeo\n\n\[Assistir no YouTube\]\(https:\/\/www\.youtube\.com\/watch\?v=video1\)\n\n## Visão geral\n/
  );
});

test("reconhece variações de SEM CONTEÚDO RELEVANTE (minúsculas, com pontuação) ao montar o input", async (t) => {
  const outputDir = await makeTempOutputDir(t);
  const cfg = { outputDir, reduceModel: "modelo-forte-fake" };
  const { client, calls } = fakeClient([TWO_TOPICS, "corpo"]);

  await writeChunk(outputDir, "video1", 0, "sem conteúdo relevante.");
  await writeChunk(outputDir, "video1", 1, "conteúdo de verdade aqui");

  await consolidate("video1", cfg, client);

  assert.doesNotMatch(calls[0].messages[1].content, /sem conteúdo relevante/i);
});

test("lança erro claro quando o roteiro não vem em JSON", async (t) => {
  const outputDir = await makeTempOutputDir(t);
  const cfg = { outputDir, reduceModel: "modelo-forte-fake" };
  const { client } = fakeClient(["desculpe, não consegui montar o roteiro"]);

  await writeChunk(outputDir, "video1", 0, "resumo relevante (00:00:00)");

  await assert.rejects(() => consolidate("video1", cfg, client), /não veio em JSON/);
});

test("lança erro claro quando o roteiro volta sem nenhum tópico", async (t) => {
  const outputDir = await makeTempOutputDir(t);
  const cfg = { outputDir, reduceModel: "modelo-forte-fake" };
  const { client } = fakeClient([outlineJson([])]);

  await writeChunk(outputDir, "video1", 0, "resumo relevante (00:00:00)");

  await assert.rejects(
    () => consolidate("video1", cfg, client),
    /não identificou nenhum tópico/
  );
});

test("lança erro claro quando nenhum chunk tem conteúdo relevante, sem chamar o client", async (t) => {
  const outputDir = await makeTempOutputDir(t);
  const cfg = { outputDir, reduceModel: "modelo-forte-fake" };
  const { client, calls } = fakeClient(["não devia chegar aqui"]);

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
  const { client, calls } = fakeClient(["não devia chegar aqui"]);

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
        create: async (params) => {
          attempts += 1;
          if (attempts === 1) {
            const err = new Error("rate limit");
            err.status = 429;
            throw err;
          }
          const isOutline = params.response_format !== undefined;
          return {
            choices: [{ message: { content: isOutline ? TWO_TOPICS : "corpo do tópico" } }],
          };
        },
      },
    },
  };

  await writeChunk(outputDir, "video1", 0, "resumo relevante (00:00:00)");

  const markdown = await consolidate("video1", cfg, client, { retryDelayMs: 5 });

  assert.match(markdown, /corpo do tópico/);
  assert.equal(attempts, 4, "1 falha + roteiro + 2 tópicos");
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
  const { client } = fakeClient([TWO_TOPICS, "corpo"]);

  await writeChunk(outputDir, "video1", 0, "resumo relevante (00:00:00)");

  await consolidate("video1", cfg, client, { fileName: "resumo-alternativo.md" });

  const saved = await readFile(
    path.join(outputDir, "video1", "resumo-alternativo.md"),
    "utf8"
  );
  assert.match(saved, /Visão geral/);

  await assert.rejects(() =>
    readFile(path.join(outputDir, "video1", "resumo-final.md"), "utf8")
  );
});

test("reduceCallCount conta o roteiro mais o teto de tópicos", () => {
  assert.equal(reduceCallCount({ reduceMaxTopics: 6 }), 7);
  assert.equal(reduceCallCount({}), 11); // teto padrão de 10 tópicos
});
