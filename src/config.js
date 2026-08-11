import "dotenv/config";

function envInt(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const value = Number.parseInt(raw, 10);
  return Number.isNaN(value) ? fallback : value;
}

function envFloat(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const value = Number.parseFloat(raw);
  return Number.isNaN(value) ? fallback : value;
}

export const config = {
  openaiApiKey: process.env.OPENAI_API_KEY ?? "",

  mapModel: process.env.MAP_MODEL ?? "gpt-4o-mini",
  reduceModel: process.env.REDUCE_MODEL ?? "gpt-4o",

  chunkSizeWords: envInt("CHUNK_SIZE_WORDS", 5000),
  chunkOverlapWords: envInt("CHUNK_OVERLAP_WORDS", 200),

  mapConcurrency: envInt("MAP_CONCURRENCY", 3),

  pricing: {
    mapModel: {
      inputPer1M: envFloat("MAP_MODEL_PRICE_INPUT_PER_1M", 0.15),
      outputPer1M: envFloat("MAP_MODEL_PRICE_OUTPUT_PER_1M", 0.6),
    },
    reduceModel: {
      inputPer1M: envFloat("REDUCE_MODEL_PRICE_INPUT_PER_1M", 2.5),
      outputPer1M: envFloat("REDUCE_MODEL_PRICE_OUTPUT_PER_1M", 10.0),
    },
  },

  outputDir: "output",
};
