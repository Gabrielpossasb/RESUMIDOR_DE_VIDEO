import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { videoDirOrFallback } from "../outputPaths.js";

const DEFAULT_MAX_TOPICS = 10;

const OUTLINE_MAX_TOKENS = 4000;
const TOPIC_MAX_TOKENS = 3000;

function maxTopics(cfg) {
  return cfg.reduceMaxTopics ?? DEFAULT_MAX_TOPICS;
}

// O REDUCE faz 1 chamada pro roteiro + 1 por tópico. Como o número de tópicos
// só é conhecido depois da primeira chamada, a estimativa de custo usa o teto.
export function reduceCallCount(cfg) {
  return 1 + maxTopics(cfg);
}

function buildOutlinePrompt(limit) {
  return `Abaixo estão resumos sequenciais de blocos de um vídeo técnico longo, em ordem
cronológica. Cada ponto traz um timestamp no formato (HH:MM:SS).

Sua tarefa é identificar os TÓPICOS discutidos no vídeo, na ordem cronológica em
que aparecem, e escrever uma visão geral de cada um.

Regras:
- Entre 4 e ${limit} tópicos. Agrupe assuntos próximos num mesmo tópico; não crie
  um tópico para cada ponto isolado.
- Os tópicos devem cobrir o vídeo do início ao fim, sem lacunas grandes e sem
  sobreposição entre eles.
- "titulo": curto e específico (no máximo 8 palavras), descrevendo o assunto em
  si. Evite rótulos genéricos como "Introdução" ou "Considerações finais", a não
  ser que o trecho realmente não trate de outra coisa.
- "inicio" e "fim": timestamps HH:MM:SS tirados dos resumos, delimitando o trecho
  do vídeo em que o tópico é discutido.
- "resumo": UM parágrafo de 3 a 5 frases, em português e em linguagem natural,
  explicando o que se discute nesse tópico e qual posição é defendida. Sem
  bullets, sem timestamps dentro do parágrafo, e sem narrar a gravação ("no
  vídeo ele diz que...") — explique o conteúdo diretamente.
- Não invente nada que não esteja nos resumos de origem.

Responda apenas com um JSON neste formato, sem texto em volta:
{"topicos":[{"titulo":"...","inicio":"HH:MM:SS","fim":"HH:MM:SS","resumo":"..."}]}`;
}

function buildTopicPrompt(topic, position, allTopics) {
  const outline = allTopics
    .map((t, i) => `${i + 1}. ${t.titulo}${formatRange(t) ? ` (${formatRange(t)})` : ""}`)
    .join("\n");

  return `Abaixo estão resumos sequenciais de blocos de um vídeo técnico longo. O vídeo foi
dividido nos seguintes tópicos, em ordem cronológica:

${outline}

Escreva APENAS a seção detalhada do tópico ${position}: "${topic.titulo}".

Regras:
- Texto corrido em português, de 2 a 4 parágrafos. Nada de bullets, listas,
  subtítulos ou títulos — a seção começa direto no primeiro parágrafo.
- Explique o assunto de verdade: o raciocínio por trás de cada afirmação, os
  exemplos, analogias, números e nomes citados. Quem ler deve entender o
  conteúdo sem ter assistido ao vídeo.
- Cubra TODAS as informações dos resumos de origem que pertencem a este tópico,
  não só as principais. Em compensação, não repita a mesma ideia com outras
  palavras: o texto deve ser denso, não longo.
- Não trate de assuntos que pertencem aos outros tópicos da lista.
- Não cite trechos literais e não escreva timestamps no meio do texto.
- Não narre a gravação ("o entrevistado comenta que...") — explique o conteúdo
  diretamente, como se estivesse escrevendo sobre o tema.
- Não invente nada que não esteja nos resumos de origem.
- Termine com uma última linha isolada, exatamente neste formato, listando em
  ordem crescente os timestamps dos resumos que embasaram a seção:
  Timestamps: HH:MM:SS, HH:MM:SS, HH:MM:SS`;
}

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

async function createWithRetry(client, params, { retries = 3, retryDelayMs = 5000 } = {}) {
  for (let attempt = 0; ; attempt++) {
    try {
      return await client.chat.completions.create(params);
    } catch (err) {
      if (err?.status !== 429 || attempt >= retries) throw err;
      await new Promise((resolve) => setTimeout(resolve, retryDelayMs * (attempt + 1)));
    }
  }
}

// o modelo às vezes embrulha o JSON em ``` ou escreve uma linha antes dele
function parseOutline(raw) {
  const stripped = raw
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "");

  const start = stripped.search(/[[{]/);
  const end = Math.max(stripped.lastIndexOf("]"), stripped.lastIndexOf("}"));
  if (start === -1 || end === -1) {
    throw new Error(`Roteiro do REDUCE não veio em JSON:\n${raw.slice(0, 300)}`);
  }

  let parsed;
  try {
    parsed = JSON.parse(stripped.slice(start, end + 1));
  } catch {
    throw new Error(`Roteiro do REDUCE não veio em JSON válido:\n${raw.slice(0, 300)}`);
  }

  const topics = Array.isArray(parsed) ? parsed : parsed.topicos ?? parsed.topics;
  if (!Array.isArray(topics)) {
    throw new Error(`Roteiro do REDUCE não trouxe a lista "topicos":\n${raw.slice(0, 300)}`);
  }

  return topics
    .filter((t) => t && typeof t.titulo === "string" && t.titulo.trim())
    .map((t) => ({
      titulo: t.titulo.trim(),
      inicio: typeof t.inicio === "string" ? t.inicio.trim() : "",
      fim: typeof t.fim === "string" ? t.fim.trim() : "",
      resumo: typeof t.resumo === "string" ? t.resumo.trim() : "",
    }));
}

function formatRange(topic) {
  if (topic.inicio && topic.fim && topic.inicio !== topic.fim) {
    return `${topic.inicio} – ${topic.fim}`;
  }
  return topic.inicio || topic.fim || "";
}

// normaliza a linha final de referências pra sempre sair como "*Timestamps: ...*"
const TIMESTAMP_LINE = /^[*_\s]*(?:timestamps?|fontes?)\s*:\s*(.+?)[*_\s]*$/i;

function formatSectionBody(raw) {
  const lines = raw.trim().split("\n");

  for (let i = lines.length - 1; i >= 0; i--) {
    if (!lines[i].trim()) continue;

    const match = lines[i].match(TIMESTAMP_LINE);
    if (match) {
      lines[i] = `*Timestamps: ${match[1].trim()}*`;
      // garante linha em branco separando o parágrafo da linha de referências
      if (i > 0 && lines[i - 1].trim()) lines.splice(i, 0, "");
    }
    break;
  }

  return lines.join("\n").trim();
}

async function buildOutline(combinedSummaries, cfg, client, retryDelayMs) {
  const response = await createWithRetry(
    client,
    {
      model: cfg.reduceModel,
      max_tokens: OUTLINE_MAX_TOKENS,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: buildOutlinePrompt(maxTopics(cfg)) },
        { role: "user", content: combinedSummaries },
      ],
    },
    { retryDelayMs }
  );

  return parseOutline(response.choices[0].message.content);
}

async function buildTopicSection(
  topic,
  position,
  allTopics,
  combinedSummaries,
  cfg,
  client,
  retryDelayMs
) {
  const response = await createWithRetry(
    client,
    {
      model: cfg.reduceModel,
      max_tokens: TOPIC_MAX_TOKENS,
      messages: [
        { role: "system", content: buildTopicPrompt(topic, position, allTopics) },
        { role: "user", content: combinedSummaries },
      ],
    },
    { retryDelayMs }
  );

  return formatSectionBody(response.choices[0].message.content);
}

function buildOverview(topics) {
  const entries = topics.map((topic, i) => {
    const range = formatRange(topic);
    const title = `**${i + 1}. ${topic.titulo}**${range ? ` (${range})` : ""}`;
    return topic.resumo ? `${title}\n\n${topic.resumo}` : title;
  });

  return `## Visão geral\n\n${entries.join("\n\n")}`;
}

export async function consolidate(videoId, cfg, client, options = {}) {
  const fileName = options.fileName ?? "resumo-final.md";
  const retryDelayMs = options.retryDelayMs ?? 5000;
  const dir = await videoDirOrFallback(videoId, cfg);
  const finalPath = path.join(dir, fileName);

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

  const topics = (await buildOutline(combinedSummaries, cfg, client, retryDelayMs)).slice(
    0,
    maxTopics(cfg)
  );

  if (topics.length === 0) {
    throw new Error(
      `O REDUCE não identificou nenhum tópico para o vídeo "${videoId}".`
    );
  }

  // sequencial (não Promise.all): chamadas em paralelo pro mesmo modelo caro
  // estouram limites de tokens/min de contas com tier baixo.
  const sections = [];
  for (const [i, topic] of topics.entries()) {
    sections.push(
      await buildTopicSection(
        topic,
        i + 1,
        topics,
        combinedSummaries,
        cfg,
        client,
        retryDelayMs
      )
    );
  }

  const detail = topics
    .map((topic, i) => `## ${i + 1}. ${topic.titulo}\n\n${sections[i]}`)
    .join("\n\n");

  const meta = await readMeta(dir);
  const markdown =
    buildHeading(videoId, meta) + buildOverview(topics) + "\n\n---\n\n" + detail + "\n";

  await mkdir(dir, { recursive: true });
  await writeFile(finalPath, markdown, "utf8");

  return markdown;
}
