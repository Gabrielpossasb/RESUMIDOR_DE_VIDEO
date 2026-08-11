import { test } from "node:test";
import assert from "node:assert/strict";
import { createOpenAIClient } from "../src/openaiClient.js";

test("cria um client com a apiKey configurada, sem disparar chamada de rede", () => {
  const client = createOpenAIClient("fake-key");
  assert.equal(typeof client.chat.completions.create, "function");
});
