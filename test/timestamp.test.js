import { test } from "node:test";
import assert from "node:assert/strict";
import { formatTimestamp } from "../src/chunk/timestamp.js";

test("zero segundos", () => {
  assert.equal(formatTimestamp(0), "00:00:00");
});

test("só segundos", () => {
  assert.equal(formatTimestamp(45), "00:00:45");
});

test("minutos e segundos", () => {
  assert.equal(formatTimestamp(65), "00:01:05");
});

test("uma hora exata", () => {
  assert.equal(formatTimestamp(3600), "01:00:00");
});

test("horas, minutos e segundos", () => {
  assert.equal(formatTimestamp(3661), "01:01:01");
});

test("vídeo longo (mais de 10h)", () => {
  assert.equal(formatTimestamp(36000), "10:00:00");
});

test("valor fracionário é truncado", () => {
  assert.equal(formatTimestamp(59.9), "00:00:59");
});

test("valor negativo vira zero", () => {
  assert.equal(formatTimestamp(-5), "00:00:00");
});
