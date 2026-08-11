import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import pLimit from "p-limit";

const MAP_SYSTEM_PROMPT = `Este é um trecho de um podcast técnico. Extraia:
1. As teses/argumentos defendidos (o que a pessoa DEFENDE, não só o que foi dito)
2. Conceitos técnicos explicados
3. Ferramentas, projetos, livros ou pessoas mencionados
4. Recomendações práticas

Ignore conversa fiada, piadas e digressões sem conteúdo.
Se o trecho não tiver conteúdo relevante, responda apenas: SEM CONTEÚDO RELEVANTE.

O texto contém marcadores como [HH:MM:SS] indicando o timestamp aproximado
daquele ponto da fala. Inclua o timestamp aproximado de cada ponto extraído,
usando esses marcadores como referência.`;

function chunksDir(videoId, cfg) {
  return path.join(cfg.outputDir, videoId, "chunks");
}

function chunkFilePath(dir, index) {
  return path.join(dir, `chunk-${String(index).padStart(3, "0")}.json`);
}

async function readCachedResult(filePath) {
  try {
    const raw = await readFile(filePath, "utf8");
    return JSON.parse(raw);
  } catch (err) {
    if (err.code === "ENOENT") return null;
    throw err;
  }
}

async function callMapModel(chunk, cfg, client) {
  const response = await client.chat.completions.create({
    model: cfg.mapModel,
    messages: [
      { role: "system", content: MAP_SYSTEM_PROMPT },
      { role: "user", content: chunk.text },
    ],
  });

  return response.choices[0].message.content.trim();
}

async function summarizeOneChunk(chunk, index, dir, cfg, client) {
  const filePath = chunkFilePath(dir, index);

  const cached = await readCachedResult(filePath);
  if (cached) return cached;

  const summary = await callMapModel(chunk, cfg, client);

  const result = {
    index,
    startTime: chunk.startTime,
    endTime: chunk.endTime,
    summary,
  };

  await writeFile(filePath, JSON.stringify(result, null, 2), "utf8");

  return result;
}

export async function summarizeChunks(chunks, videoId, cfg, client) {
  const dir = chunksDir(videoId, cfg);
  await mkdir(dir, { recursive: true });

  const limit = pLimit(cfg.mapConcurrency);

  return Promise.all(
    chunks.map((chunk, index) =>
      limit(() => summarizeOneChunk(chunk, index, dir, cfg, client))
    )
  );
}
