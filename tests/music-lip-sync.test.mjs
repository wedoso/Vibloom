import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

const source = await readFile(new URL("../src/live2d/musicLipSync.ts", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
const { MusicLipSync } = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString("base64")}`);

function fixture() {
  const values = [0, 0.5]; // Mouth openness and an unrelated smile.
  const model = {
    getParameterIndex: (id) => ["mouth", "smile"].indexOf(id) < 0 ? 2 : ["mouth", "smile"].indexOf(id),
    getParameterCount: () => 2,
    setParameterValueByIndex: (index, value) => { assert.ok(index < 2); values[index] = value; },
  };
  const sync = new MusicLipSync(model, ["mouth", "missing", "mouth"]);
  return { values, sync };
}

test("lip sync follows the vocal level without accumulating authored mouth curves or changing smiles", () => {
  const { values, sync } = fixture();
  for (let i = 0; i < 120; i++) {
    values[0] = 0.95; // Authored motion/expression has already updated this frame.
    sync.update(1, true, 1 / 60);
    assert.ok(values[0] >= 0 && values[0] <= 1);
    assert.equal(values[1], 0.5);
  }
  assert.ok(values[0] > 0.99);
});

test("pause and absent vocals both close the mouth even if the mix is loud", () => {
  for (const playing of [true, false]) {
    const { values, sync } = fixture();
    sync.update(1, true, 1);
    for (let i = 0; i < 30; i++) sync.update(playing ? 0 : 1, playing, 1 / 60);
    assert.ok(values[0] < 0.002);
  }
});

test("lip envelope is frame-rate independent and bounds invalid vocal levels", () => {
  const result = [];
  for (const fps of [30, 60, 120]) {
    const { values, sync } = fixture();
    for (let i = 0; i < fps / 10; i++) sync.update(1, true, 1 / fps);
    result.push(values[0]);
  }
  assert.ok(Math.max(...result) - Math.min(...result) < 1e-10);
  const { values, sync } = fixture();
  for (const level of [NaN, Infinity, -1, 10]) {
    sync.update(level, true, 1);
    assert.ok(Number.isFinite(values[0]) && values[0] >= 0 && values[0] <= 1);
  }
});


test("short bilabial closures reach the rig within 60 ms and do not alter other channels", () => {
  const { values, sync } = fixture();
  sync.update({ open: 1, form: 1 }, true, 1);
  sync.update({ open: 0, form: 0 }, true, .06);
  assert.ok(values[0] < .04);
  assert.equal(values[1], .5);
});
