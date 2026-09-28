import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

const source = await readFile(new URL("../src/audio/vocals/envelope.ts", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
const { vocalEnvelope, sampleVocalEnvelope } = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString("base64")}`);

test("loud instrumental audio cannot open the mouth without a separated vocal signal", () => {
  const mix = new Float32Array(4410).fill(0.8), silent = new Float32Array(4410);
  assert.ok(vocalEnvelope(silent, silent, mix, mix).every((v) => v === 0));
  const leakage = new Float32Array(4410).fill(0.007);
  assert.ok(vocalEnvelope(leakage, leakage, mix, mix).every((v) => v === 0));
  const vocals = new Float32Array(4410).fill(0.15);
  const frames = vocalEnvelope(vocals, vocals, mix, mix);
  assert.equal(frames.length, 5);
  assert.ok(sampleVocalEnvelope(frames, 0.02, 0.9) > 0.5);
});

test("vocal timing follows seek positions and volume, including unavailable or ended stems", () => {
  const frames = Float32Array.from([0, 0.2, 0, 0.1]);
  assert.equal(sampleVocalEnvelope(frames, 0, 1), 0);
  assert.ok(sampleVocalEnvelope(frames, 0.02, 1) > sampleVocalEnvelope(frames, 0.02, 0.1));
  assert.equal(sampleVocalEnvelope(frames, 0.02, 0), 0);
  assert.equal(sampleVocalEnvelope(frames, 0.04, 1), 0);
  for (const time of [-1, NaN, Infinity, 0.08, 10]) assert.equal(sampleVocalEnvelope(frames, time, 1), 0);
  assert.equal(sampleVocalEnvelope(null, 0.02, 1), 0);
});
