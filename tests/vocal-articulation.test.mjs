import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

const moduleUrl = source => `data:text/javascript;base64,${Buffer.from(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText).toString("base64")}`;
const envelope = moduleUrl(await readFile(new URL("../src/audio/vocals/envelope.ts", import.meta.url), "utf8"));
const source = (await readFile(new URL("../src/audio/vocals/articulation.ts", import.meta.url), "utf8")).replace('"./envelope"', JSON.stringify(envelope));
const { buildVocalCurves, sampleVocalCurves } = await import(moduleUrl(source));
const { isCurrentVocalAnalysis, migrateLibrarySnapshot } = await import(moduleUrl(await readFile(new URL("../src/domain/library.ts", import.meta.url), "utf8")));
const weights = (n, channel) => Uint8Array.from({ length: n * 5 }, (_, i) => i % 5 === channel ? 255 : 0);
const voice = (n = 100) => new Float32Array(n).fill(.2);

test("jaw follows acoustic onset, dips and silence independently of MotionSync shape weights", () => {
  const rms = voice(); rms.fill(0, 0, 10); rms.fill(.05, 30, 40); rms.fill(0, 80);
  const curves = buildVocalCurves(rms, weights(100, 2));
  assert.equal(curves.open[9], 0);
  assert.ok(curves.open[10] > .4, "no added classifier onset delay");
  assert.ok(curves.open[35] < curves.open[20] * .5);
  assert.equal(curves.open[82], 0);
  for (const shape of [weights(100, 4), new Uint8Array(500)]) assert.deepEqual(curves.open, buildVocalCurves(rms, shape).open);
});

test("continuous O/U blends retain identity without discrete winner holds", () => {
  const data = weights(100, 3);
  for (let i = 30; i < 60; i++) { data[i * 5 + 3] = 128; data[i * 5 + 4] = 127; }
  for (let i = 60; i < 100; i++) { data[i * 5 + 3] = 0; data[i * 5 + 4] = 255; }
  const curves = buildVocalCurves(voice(), data);
  assert.deepEqual(sampleVocalCurves(curves, .4, 1).vowels, [0, 0, 0, 1, 0]);
  const blend = sampleVocalCurves(curves, .8, 1).vowels;
  assert.ok(Math.abs(blend[3] - 128 / 255) < 1e-6 && Math.abs(blend[4] - 127 / 255) < 1e-6);
  assert.deepEqual(sampleVocalCurves(curves, 1.5, 1).vowels, [0, 0, 0, 0, 1]);
  assert.ok(curves.form[60] < curves.form[59] && curves.form[60] > curves.form[64]);
});

test("short gate holes bridge; meaningful silence and quiet valleys remain closed or shallow", () => {
  const rms = voice(); rms.fill(0, 30, 32); rms.fill(0, 50, 55); rms.fill(.006, 70, 85);
  const curves = buildVocalCurves(rms, weights(100, 4));
  assert.ok(curves.open[31] > .5);
  assert.equal(curves.open[52], 0);
  assert.ok(Number.isNaN(curves.form[52]));
  assert.ok(curves.open[80] < .15, "no invented sustained-vowel aperture floor");
});

test("seek, volume and cubic sampling stay deterministic, bounded and settle to silence", () => {
  const rms = new Float32Array(80); rms.fill(.2, 10, 40);
  const curves = buildVocalCurves(rms, weights(80, 2));
  assert.ok(curves.open[10] < curves.open[11] && curves.open[11] < curves.open[12]);
  assert.ok(curves.open[40] > curves.open[41] && curves.open[41] > curves.open[42]);
  assert.equal(curves.open[42], 0);
  for (let i = 0; i < 79; i++) for (let f = 0; f < 1; f += .1) {
    const value = sampleVocalCurves(curves, (i + f) / 50, 1).open;
    assert.ok(value >= Math.min(curves.open[i], curves.open[i + 1]) - 1e-6 && value <= Math.max(curves.open[i], curves.open[i + 1]) + 1e-6);
  }
  assert.deepEqual(sampleVocalCurves(curves, .4, 1), sampleVocalCurves(curves, .4, 1));
  assert.ok(sampleVocalCurves(curves, .4, .1).open < .4);
  for (const time of [-1, NaN, Infinity, 2, 10]) assert.equal(sampleVocalCurves(curves, time, 1).open, 0);
  assert.equal(sampleVocalCurves(curves, .4, 0).open, 0);
  assert.equal(sampleVocalCurves(buildVocalCurves(new Float32Array(), new Uint8Array()), 0, 1).open, 0);
  assert.throws(() => buildVocalCurves(voice(), new Uint8Array(100)));
});

test("only complete version 4 caches are reused; legacy metadata survives migration", () => {
  const valid = { version: 4, rms: [.1, .2], vowels: [0, 0, 255, 0, 0, 128, 127, 0, 0, 0] };
  assert.ok(isCurrentVocalAnalysis(valid, .04));
  for (const invalid of [undefined, { ...valid, version: 3 }, { ...valid, rms: [NaN, .2] }, { ...valid, vowels: [255] }, { ...valid, vowels: valid.vowels.map(() => 256) }, { ...valid, vowels: valid.vowels.map(() => .5) }]) assert.equal(isCurrentVocalAnalysis(invalid), false);
  assert.equal(isCurrentVocalAnalysis(valid, 1), false);
  for (const version of [1, 2, 3]) {
    const old = { version, rms: [.1], visemes: [2] };
    const migrated = migrateLibrarySnapshot({ version: 2, tracks: [{ id: "A", lyrics: [{ text: "歌" }], vocalAnalysis: old, comparison: { vocalAnalysis: old } }], session: {} });
    assert.deepEqual(migrated.tracks[0].vocalAnalysis, old);
    assert.deepEqual(migrated.tracks[0].comparison.vocalAnalysis, old);
    assert.equal(migrated.tracks[0].lyrics[0].text, "歌");
    assert.equal(isCurrentVocalAnalysis(old), false);
  }
});
