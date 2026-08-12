import { REDUCE_SECTION_COUNT } from "../reduce/consolidate.js";

const CHARS_PER_TOKEN = 4;

function estimateTokens(text) {
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}

export function estimateCost(chunks, cfg) {
  const { pricing, estimate } = cfg;

  const mapInputTokens = chunks.reduce(
    (sum, chunk) => sum + estimateTokens(chunk.text),
    0
  );
  const mapOutputTokens = Math.ceil(mapInputTokens * estimate.mapOutputRatio);

  // REDUCE faz uma chamada por seção (ver consolidate.js), cada uma recebendo
  // o mesmo input completo — o custo de input é multiplicado pelo número de
  // seções. O output não é multiplicado: é a soma dos outputs das seções,
  // calibrado a partir do total do MAP.
  const reduceInputTokens = mapOutputTokens * REDUCE_SECTION_COUNT;
  const reduceOutputTokens = Math.ceil(
    mapOutputTokens * estimate.reduceOutputRatio
  );

  const mapCostUsd =
    (mapInputTokens / 1_000_000) * pricing.mapModel.inputPer1M +
    (mapOutputTokens / 1_000_000) * pricing.mapModel.outputPer1M;

  const reduceCostUsd =
    (reduceInputTokens / 1_000_000) * pricing.reduceModel.inputPer1M +
    (reduceOutputTokens / 1_000_000) * pricing.reduceModel.outputPer1M;

  return {
    chunkCount: chunks.length,
    mapInputTokens,
    mapOutputTokens,
    reduceInputTokens,
    reduceOutputTokens,
    mapCostUsd,
    reduceCostUsd,
    totalCostUsd: mapCostUsd + reduceCostUsd,
  };
}
