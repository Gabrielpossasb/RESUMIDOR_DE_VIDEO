import { test } from "node:test";
import assert from "node:assert/strict";
import { parseArgs } from "../src/cli.js";

test("extrai a URL e nenhuma flag por padrão", () => {
  const { url, flags } = parseArgs(["https://youtu.be/abc"]);
  assert.equal(url, "https://youtu.be/abc");
  assert.deepEqual(flags, {
    skipFetch: false,
    skipMap: false,
    skipReduce: false,
    yes: false,
  });
});

test("reconhece todas as flags de skip e --yes, em qualquer ordem", () => {
  const { url, flags } = parseArgs([
    "--skip-map",
    "https://youtu.be/abc",
    "--yes",
    "--skip-reduce",
    "--skip-fetch",
  ]);

  assert.equal(url, "https://youtu.be/abc");
  assert.deepEqual(flags, {
    skipFetch: true,
    skipMap: true,
    skipReduce: true,
    yes: true,
  });
});

test("sem URL retorna url nulo", () => {
  const { url } = parseArgs(["--yes"]);
  assert.equal(url, null);
});
