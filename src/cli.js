import { createInterface } from "node:readline/promises";
import { config } from "./config.js";
import { createOpenAIClient } from "./openaiClient.js";
import { extractVideoId } from "./fetch/videoId.js";
import { fetchTranscript, readCachedTranscript } from "./fetch/transcript.js";
import { chunkTranscript } from "./chunk/chunker.js";
import { estimateCost } from "./cost/estimate.js";
import { summarizeChunks } from "./map/summarizeChunks.js";
import { consolidate } from "./reduce/consolidate.js";

const USAGE =
  "Uso: node index.js <url-do-youtube> [--skip-fetch] [--skip-map] [--skip-reduce] [--yes]";

export function parseArgs(argv) {
  const flags = { skipFetch: false, skipMap: false, skipReduce: false, yes: false };
  let url = null;

  for (const arg of argv) {
    switch (arg) {
      case "--skip-fetch":
        flags.skipFetch = true;
        break;
      case "--skip-map":
        flags.skipMap = true;
        break;
      case "--skip-reduce":
        flags.skipReduce = true;
        break;
      case "--yes":
        flags.yes = true;
        break;
      default:
        if (!arg.startsWith("--")) url = arg;
    }
  }

  return { url, flags };
}

async function confirm(question) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = await rl.question(`${question} [s/N] `);
    return answer.trim().toLowerCase() === "s";
  } finally {
    rl.close();
  }
}

export async function runCli(argv) {
  const { url, flags } = parseArgs(argv);

  if (!url) {
    throw new Error(USAGE);
  }

  const videoId = extractVideoId(url);
  console.log(`Vídeo: ${videoId}`);

  const client = createOpenAIClient(config.openaiApiKey);

  if (!flags.skipMap) {
    const segments = flags.skipFetch
      ? await readCachedTranscript(videoId)
      : await fetchTranscript(videoId);
    console.log(`Transcrição: ${segments.length} segmento(s).`);

    const chunks = chunkTranscript(segments, config);
    console.log(`Dividido em ${chunks.length} bloco(s).`);

    const estimate = estimateCost(chunks, config);
    console.log(
      `Custo estimado: ~US$ ${estimate.totalCostUsd.toFixed(4)} ` +
        `(MAP: US$ ${estimate.mapCostUsd.toFixed(4)}, REDUCE: US$ ${estimate.reduceCostUsd.toFixed(4)})`
    );

    if (!flags.yes) {
      const proceed = await confirm("Prosseguir com as chamadas pagas?");
      if (!proceed) {
        console.log("Cancelado.");
        return;
      }
    }

    console.log("Processando blocos (MAP)...");
    await summarizeChunks(chunks, videoId, config, client);
    console.log("MAP concluído.");
  } else {
    console.log("MAP pulado (--skip-map) — usando chunks já processados.");
  }

  if (!flags.skipReduce) {
    console.log("Consolidando resumo final (REDUCE)...");
    await consolidate(videoId, config, client);
    console.log(`Pronto: output/${videoId}/resumo-final.md`);
  } else {
    console.log("REDUCE pulado (--skip-reduce).");
  }
}
