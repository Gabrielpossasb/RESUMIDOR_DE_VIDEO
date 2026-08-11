import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  slugify,
  buildVideoDirName,
  resolveVideoDir,
  videoDirOrFallback,
} from "../src/outputPaths.js";

async function makeTempDir(t) {
  const dir = await mkdtemp(path.join(tmpdir(), "resumidor-outputpaths-test-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return dir;
}

test("slugify remove acentos, baixa caixa e troca não-alfanumérico por hífen", () => {
  assert.equal(
    slugify("Fábio Akita fala sobre programação e IA!"),
    "fabio-akita-fala-sobre-programacao-e-ia"
  );
});

test("slugify trunca em 60 caracteres sem deixar hífen sobrando no final", () => {
  const longo = "palavra ".repeat(20).trim();
  const slug = slugify(longo);
  assert.ok(slug.length <= 60);
  assert.ok(!slug.endsWith("-"));
});

test("slugify de string vazia ou só símbolos vira string vazia", () => {
  assert.equal(slugify(""), "");
  assert.equal(slugify("!!!???"), "");
});

test("buildVideoDirName combina slug e videoId", () => {
  assert.equal(
    buildVideoDirName("d4j02XdB77g", "Título Qualquer"),
    "titulo-qualquer-d4j02XdB77g"
  );
});

test("buildVideoDirName sem título válido usa só o videoId", () => {
  assert.equal(buildVideoDirName("xyz", ""), "xyz");
  assert.equal(buildVideoDirName("xyz", "!!!"), "xyz");
});

test("resolveVideoDir acha pasta com nome exatamente igual ao videoId", async (t) => {
  const outputDir = await makeTempDir(t);
  await mkdir(path.join(outputDir, "abc123"), { recursive: true });

  const found = await resolveVideoDir("abc123", { outputDir });
  assert.equal(found, path.join(outputDir, "abc123"));
});

test("resolveVideoDir acha pasta com slug-videoId", async (t) => {
  const outputDir = await makeTempDir(t);
  await mkdir(path.join(outputDir, "titulo-legal-abc123"), { recursive: true });

  const found = await resolveVideoDir("abc123", { outputDir });
  assert.equal(found, path.join(outputDir, "titulo-legal-abc123"));
});

test("resolveVideoDir retorna null quando não há pasta nem outputDir", async (t) => {
  const outputDir = path.join(await makeTempDir(t), "nao-existe");
  assert.equal(await resolveVideoDir("abc123", { outputDir }), null);
});

test("videoDirOrFallback usa videoId puro quando não encontra pasta existente", async (t) => {
  const outputDir = path.join(await makeTempDir(t), "nao-existe");
  const dir = await videoDirOrFallback("abc123", { outputDir });
  assert.equal(dir, path.join(outputDir, "abc123"));
});
