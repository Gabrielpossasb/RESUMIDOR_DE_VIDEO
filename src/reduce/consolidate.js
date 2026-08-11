import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { videoDirOrFallback } from "../outputPaths.js";

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
- Preserve a nuance: se a pessoa critica X mas defende Y relacionado, isso precisa ficar claro.
- Não inclua um título ou cabeçalho de nível 1 no início do documento — isso já
  é adicionado separadamente. Comece direto pela seção "Teses principais".`;

function hasNoRelevantContent(summary) {
  return summary.trim().toUpperCase().startsWith("SEM CONTEÚDO RELEVANTE");
}

async function readChunkResults(chunksDir) {
  let files;
  try {
    files = await readdir(chunksDir);
  } catch (err) {
    if (err.code === "ENOENT") return [];
    throw err;
  }

  const results = [];
  for (const file of files.filter((f) => f.endsWith(".json"))) {
    const raw = await readFile(path.join(chunksDir, file), "utf8");
    results.push(JSON.parse(raw));
  }

  return results.sort((a, b) => a.index - b.index);
}

async function readMeta(dir) {
  try {
    const raw = await readFile(path.join(dir, "meta.json"), "utf8");
    return JSON.parse(raw);
  } catch (err) {
    if (err.code === "ENOENT") return null;
    throw err;
  }
}

function buildHeading(videoId, meta) {
  const title = meta?.title ?? videoId;
  const link = meta?.url ? `[Assistir no YouTube](${meta.url})\n\n` : "";
  return `# ${title}\n\n${link}`;
}

export async function consolidate(videoId, cfg, client) {
  const dir = await videoDirOrFallback(videoId, cfg);
  const finalPath = path.join(dir, "resumo-final.md");

  try {
    return await readFile(finalPath, "utf8");
  } catch (err) {
    if (err.code !== "ENOENT") throw err;
  }

  const chunkResults = await readChunkResults(path.join(dir, "chunks"));
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

  const meta = await readMeta(dir);
  const body = response.choices[0].message.content.trim();
  const markdown = buildHeading(videoId, meta) + body;

  await mkdir(dir, { recursive: true });
  await writeFile(finalPath, markdown, "utf8");

  return markdown;
}
