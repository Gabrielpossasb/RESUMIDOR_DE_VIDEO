import { test } from "node:test";
import assert from "node:assert/strict";
import { estimateCost } from "../src/cost/estimate.js";

const baseCfg = {
  pricing: {
    mapModel: { inputPer1M: 10, outputPer1M: 20 },
    reduceModel: { inputPer1M: 100, outputPer1M: 200 },
  },
  estimate: {
    mapOutputRatio: 0.5,
    reduceOutputRatio: 0.4,
  },
};

function closeTo(actual, expected, epsilon = 1e-9) {
  assert.ok(
    Math.abs(actual - expected) < epsilon,
    `esperado ${expected}, recebeu ${actual}`
  );
}

test("lista de chunks vazia gera estimativa zerada", () => {
  const result = estimateCost([], baseCfg);

  assert.equal(result.chunkCount, 0);
  assert.equal(result.mapInputTokens, 0);
  assert.equal(result.mapOutputTokens, 0);
  assert.equal(result.reduceInputTokens, 0);
  assert.equal(result.reduceOutputTokens, 0);
  assert.equal(result.totalCostUsd, 0);
});

test("mapInputTokens soma char/4 arredondado pra cima de todos os chunks", () => {
  const chunks = [{ text: "a".repeat(3) }, { text: "b".repeat(9) }];
  // ceil(3/4) + ceil(9/4) = 1 + 3
  const result = estimateCost(chunks, baseCfg);

  assert.equal(result.mapInputTokens, 4);
  assert.equal(result.chunkCount, 2);
});

test("aplica as proporções configuradas de saída do MAP e do REDUCE", () => {
  const chunks = [{ text: "a".repeat(4000) }, { text: "b".repeat(4000) }];
  const result = estimateCost(chunks, baseCfg);

  assert.equal(result.mapInputTokens, 2000);
  assert.equal(result.mapOutputTokens, 1000); // 2000 * 0.5
  assert.equal(result.reduceInputTokens, 1000); // == mapOutputTokens
  assert.equal(result.reduceOutputTokens, 400); // 1000 * 0.4
});

test("calcula custo em USD combinando tokens estimados e preços por 1M", () => {
  const chunks = [{ text: "a".repeat(4000) }, { text: "b".repeat(4000) }];
  const result = estimateCost(chunks, baseCfg);

  // mapInput=2000 tokens * $10/1M = 0.02 | mapOutput=1000 * $20/1M = 0.02
  closeTo(result.mapCostUsd, 0.04);
  // reduceInput=1000 * $100/1M = 0.1 | reduceOutput=400 * $200/1M = 0.08
  closeTo(result.reduceCostUsd, 0.18);
  closeTo(result.totalCostUsd, 0.22);
});
