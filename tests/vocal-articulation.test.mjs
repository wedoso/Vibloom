import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

const moduleUrl = (source) => `data:text/javascript;base64,${Buffer.from(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText).toString("base64")}`;
const envelope = moduleUrl(await readFile(new URL("../src/audio/vocals/envelope.ts", import.meta.url), "utf8"));
const source = (await readFile(new URL("../src/audio/vocals/articulation.ts", import.meta.url), "utf8")).replace('"./envelope"', JSON.stringify(envelope));
const { buildVocalCurves, sampleVocalCurves } = await import(moduleUrl(source));

const voice = (length = 100) => new Float32Array(length).fill(.2);
test("jaw follows acoustic onsets and energy, independent of delayed or consonant-heavy labels", () => {
  const rms = voice(); rms.fill(0, 0, 10); rms.fill(.05, 30, 40); rms.fill(0, 80);
  const labels = new Uint8Array(100).fill(8); labels.fill(2, 14, 25);
  const {open, form} = buildVocalCurves(rms, labels);
  assert.equal(open[9], 0);
  assert.ok(open[10] > .9, "jaw opens on voice onset, not 80 ms later with the label");
  assert.equal(form[10], 1, "stable vowel aligns to the nearby acoustic onset");
  assert.ok(open[35] < open[20] * .5, "syllable energy dip survives gain normalization");
  assert.equal(open[80], 0);
  assert.deepEqual(open, buildVocalCurves(rms, new Uint8Array(100).fill(13)).open, "consonants cannot repeatedly attenuate the jaw");
});

test("brief classification excursions merge, stable vowels hold, real silence resets shape", () => {
  const rms = voice(); const labels = new Uint8Array(100).fill(2);
  labels[3] = 8; labels[6] = 4; labels.fill(4, 20, 24); labels.fill(1, 24, 28);
  rms.fill(0, 40, 50);
  const {form} = buildVocalCurves(rms, labels);
  assert.ok(Array.from(form.slice(0, 20)).every((v) => v === 1), "20 ms chatter is merged");
  assert.equal(form[20], -1);
  assert.equal(form[25], -1, "next vowel cannot interrupt the 120 ms hold");
  assert.equal(form[26], .5, "a stable next vowel is delayed, not discarded");
  assert.equal(form[32], 1);
  assert.ok(Number.isNaN(form[45]));
  assert.equal(form[50], 1, "a continuous vowel label recovers after an energy-gated gap");
  // A fresh occurrence of the same vowel after silence still selects its shape.
  labels.fill(14, 40, 50);
  assert.equal(buildVocalCurves(rms, labels).form[50], 1);
});

test("only sustained PP plus an acoustic valley closes voiced audio; short gate holes bridge", () => {
  const rms = voice(), labels = new Uint8Array(100).fill(2);
  labels.fill(5, 10, 20); // Sustained vowel misclassified as PP: no valley.
  labels.fill(5, 30, 35); rms.fill(.04, 30, 35); // Actual closure.
  labels.fill(5, 60, 62); rms.fill(.04, 60, 62); // Too short to force closure.
  rms.fill(0, 70, 72); rms.fill(0, 80, 85);
  const {open} = buildVocalCurves(rms, labels);
  assert.ok(open[15] > .9);
  assert.equal(open[32], 0);
  assert.ok(open[61] > 0);
  assert.ok(open[71] > 0, "40 ms gate dropout bridged");
  assert.equal(open[82], 0, "100 ms silence retained");
});

test("legacy 40 ms advance is undone; seek and volume sample stabilized data deterministically", () => {
  const rms = voice(), raw = new Uint8Array(100).fill(2); raw.fill(4, 30, 60);
  const advanced = Uint8Array.from(raw, (_, i) => raw[Math.min(raw.length - 1, i + 2)]);
  const current = buildVocalCurves(rms, raw), legacy = buildVocalCurves(rms, advanced, 2);
  assert.deepEqual(legacy, current);
  assert.deepEqual(sampleVocalCurves(legacy, .8, 1), sampleVocalCurves(current, .8, 1));
  assert.ok(sampleVocalCurves(current, .8, 1).open > .9);
  assert.ok(sampleVocalCurves(current, .8, .1).open < .4);
  for (const time of [-1, NaN, Infinity, 2, 10]) assert.equal(sampleVocalCurves(current, time, 1).open, 0);
  assert.equal(sampleVocalCurves(current, .8, 0).open, 0);
  assert.equal(sampleVocalCurves(buildVocalCurves(new Float32Array(), new Uint8Array()), 0, 1).open, 0);
});
