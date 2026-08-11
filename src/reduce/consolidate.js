import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const REDUCE_SYSTEM_PROMPT = `Abaixo estão resumos sequenciais de um podcast técnico longo.
Consolide num documento de estudo em markdown, organizado POR TEMA (não por ordem cronológica).

Estrutura:
- Teses principais defendidas (o núcleo do que a pessoa argumenta)
- Conceitos técnicos explicados
- Ferramentas e projetos mencionados (com o que são e para que servem)
- Recomendações práticas
- Pontos polêmicos ou contra-intuitivos

Regras:
- Agrupe ideias relacionadas mesmo que apareçam em momentos distantes do vídeo.
- Mantenha os timestamps entre parênteses para eu conseguir voltar ao trecho.
- Não invente nada que não esteja nos resumos.
- Preserve a nuance: se a pessoa critica X mas defende Y relacionado, isso precisa ficar claro.`;

function chunksDir(videoId, cfg) {
  return path.join(cfg.outputDir, videoId, "chunks");
}

function finalSummaryPath(videoId, cfg) {
  return path.join(cfg.outputDir, videoId, "resumo-final.md");
}

function hasNoRelevantContent(summary) {
  return summary.trim().toUpperCase().startsWith("SEM CONTEÚDO RELEVANTE");
}

async function readChunkResults(videoId, cfg) {
  const dir = chunksDir(videoId, cfg);

  let files;
  try {
    files = await readdir(dir);
  } catch (err) {
    if (err.code === "ENOENT") return [];
    throw err;
  }

  const results = [];
  for (const file of files.filter((f) => f.endsWith(".json"))) {
    const raw = await readFile(path.join(dir, file), "utf8");
    results.push(JSON.parse(raw));
  }

  return results.sort((a, b) => a.index - b.index);
}

export async function consolidate(videoId, cfg, client) {
  const finalPath = finalSummaryPath(videoId, cfg);

  try {
    return await readFile(finalPath, "utf8");
  } catch (err) {
    if (err.code !== "ENOENT") throw err;
  }

  const chunkResults = await readChunkResults(videoId, cfg);
  const relevant = chunkResults.filter((r) => !hasNoRelevantContent(r.summary));

  if (relevant.length === 0) {
    throw new Error(
      `Nenhum conteúdo relevante encontrado para o vídeo "${videoId}" — não há o que consolidar.`
    );
  }

  const combinedSummaries = relevant.map((r) => r.summary).join("\n\n---\n\n");

  const response = await client.chat.completions.create({
    model: cfg.reduceModel,
    messages: [
      { role: "system", content: REDUCE_SYSTEM_PROMPT },
      { role: "user", content: combinedSummaries },
    ],
  });

  const markdown = response.choices[0].message.content.trim();

  await mkdir(path.dirname(finalPath), { recursive: true });
  await writeFile(finalPath, markdown, "utf8");

  return markdown;
}
