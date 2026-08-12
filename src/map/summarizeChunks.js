import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import pLimit from "p-limit";
import { videoDirOrFallback } from "../outputPaths.js";

const MAP_SYSTEM_PROMPT = `Este é um trecho de um podcast técnico. Extraia com PROFUNDIDADE — não apenas
o título do assunto, mas o raciocínio completo, exemplos citados, números e
dados mencionados, e o contexto de por que a pessoa chegou àquela conclusão.

1. Teses/argumentos defendidos — inclua o raciocínio, não só a conclusão
2. Conceitos técnicos explicados — inclua a explicação como foi dada, com
   analogias ou exemplos usados
3. Ferramentas, projetos, livros ou pessoas mencionados — o que são e em que
   contexto foram citados
4. Recomendações práticas — com o "porquê" por trás, quando explicado

Ignore conversa fiada, piadas e digressões sem conteúdo.
Se o trecho não tiver conteúdo relevante, responda apenas: SEM CONTEÚDO RELEVANTE.
Prefira manter detalhe a economizar espaço — não resuma agressivamente nesta etapa.

O texto contém marcadores como [HH:MM:SS] indicando o timestamp aproximado
daquele ponto da fala. É OBRIGATÓRIO citar o timestamp de cada ponto extraído,
usando o marcador mais próximo como referência. Todo item da lista deve
terminar com o timestamp entre parênteses, neste formato:

- Descrição do ponto extraído (HH:MM:SS)

Nunca escreva um item sem o timestamp entre parênteses no final.`;

const MAP_MAX_TOKENS = 2000;

async function chunksDir(videoId, cfg) {
  const dir = await videoDirOrFallback(videoId, cfg);
  return path.join(dir, "chunks");
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
    max_tokens: MAP_MAX_TOKENS,
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
  const dir = await chunksDir(videoId, cfg);
  await mkdir(dir, { recursive: true });

  const limit = pLimit(cfg.mapConcurrency);

  return Promise.all(
    chunks.map((chunk, index) =>
      limit(() => summarizeOneChunk(chunk, index, dir, cfg, client))
    )
  );
}
