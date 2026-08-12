import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { videoDirOrFallback } from "../outputPaths.js";

const NO_CONTENT_MARKER = "SEM PONTOS NESTA CATEGORIA";

const SECTIONS = [
  {
    heading: "Teses principais defendidas",
    focus:
      'as teses e argumentos que a pessoa DEFENDE (não apenas menciona) — o ' +
      "núcleo do que ela argumenta, com o raciocínio completo por trás de cada tese",
  },
  {
    heading: "Conceitos técnicos explicados",
    focus:
      "conceitos técnicos que foram explicados — cada um com a explicação, " +
      "analogia ou exemplo original usado, não apenas a definição em uma linha",
  },
  {
    heading: "Ferramentas e projetos mencionados",
    focus:
      "ferramentas, projetos, livros ou pessoas mencionados — o que são, " +
      "para que servem, e o contexto específico em que foram citados",
  },
  {
    heading: "Recomendações práticas",
    focus:
      'recomendações práticas dadas — incluindo o "porquê" por trás de cada ' +
      "uma, quando explicado",
  },
  {
    heading: "Pontos polêmicos ou contra-intuitivos",
    focus:
      "pontos polêmicos, contra-intuitivos, ou opiniões que vão contra o " +
      "senso comum — com o argumento completo por trás, não só a afirmação",
  },
];

export const REDUCE_SECTION_COUNT = SECTIONS.length;

const REDUCE_MAX_TOKENS = 16000;

function buildSectionPrompt(focus) {
  return `Abaixo estão resumos sequenciais e detalhados de blocos de um podcast técnico
longo. Cada resumo de bloco já contém vários pontos substantivos.

Sua tarefa é extrair e organizar TODOS os pontos relacionados a: ${focus}.

Ignore qualquer conteúdo fora dessa categoria — as outras categorias são
processadas em chamadas separadas, então não inclua nada fora do escopo desta.

Preserve TODOS os pontos relevantes dessa categoria presentes nos resumos de
origem — não selecione só os "mais importantes". Se há muitos pontos sobre
esse tema espalhados pelos blocos, o resultado deve conter todos eles,
agrupados por subtema quando fizer sentido, sem perder nenhum.

Regras:
- Cada ponto pode ter de 2 a 5 frases (ou mais, se o assunto exigir) — preserve
  o raciocínio completo, exemplos, números e nomes citados literalmente.
- Mantenha os timestamps entre parênteses, no início ou fim de cada ponto.
- Não invente nada que não esteja nos resumos de origem.
- Quando o mesmo ponto específico aparecer em blocos diferentes com informação
  complementar, junte numa única entrada coesa — mas não funda pontos sobre
  assuntos diferentes.
- Responda só com uma lista em markdown (bullets "-"), sem título ou
  cabeçalho — isso é adicionado separadamente.
- Se não houver NENHUM ponto relevante para essa categoria nos resumos de
  origem, responda apenas: ${NO_CONTENT_MARKER}`;
}

function hasNoRelevantContent(summary) {
  return summary.trim().toUpperCase().startsWith("SEM CONTEÚDO RELEVANTE");
}

function isEmptySection(body) {
  return body.trim().toUpperCase().startsWith(NO_CONTENT_MARKER);
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

async function buildSection(section, combinedSummaries, cfg, client, retryDelayMs) {
  const response = await createWithRetry(
    client,
    {
      model: cfg.reduceModel,
      max_tokens: REDUCE_MAX_TOKENS,
      messages: [
        { role: "system", content: buildSectionPrompt(section.focus) },
        { role: "user", content: combinedSummaries },
      ],
    },
    { retryDelayMs }
  );

  return {
    heading: section.heading,
    body: response.choices[0].message.content.trim(),
  };
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

  // sequencial (não Promise.all): chamadas em paralelo pro mesmo modelo caro
  // estouram limites de tokens/min de contas com tier baixo.
  const sections = [];
  for (const section of SECTIONS) {
    sections.push(
      await buildSection(section, combinedSummaries, cfg, client, retryDelayMs)
    );
  }

  const meta = await readMeta(dir);
  const body = sections
    .filter((section) => !isEmptySection(section.body))
    .map((section) => `## ${section.heading}\n\n${section.body}`)
    .join("\n\n");

  const markdown = buildHeading(videoId, meta) + body;

  await mkdir(dir, { recursive: true });
  await writeFile(finalPath, markdown, "utf8");

  return markdown;
}
