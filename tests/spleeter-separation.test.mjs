import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

const source = ts.transpileModule(await readFile(new URL("../src/audio/vocals/spleeterSeparation.ts", import.meta.url), "utf8"), {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText.replace("'demucs-web'", JSON.stringify(import.meta.resolve("demucs-web")));
const { separateSpleeter, SpleeterWorkspace } = await import(`data:text/javascript;base64,${Buffer.from(source).toString("base64")}`);
function fixture(failure = "") {
  const tensors = [], shapes = [];
  class Tensor {
    constructor(_type, data, dims) { this.data = data; this.dims = dims; tensors.push(this); }
    dispose() { assert.ok(!this.disposed, "tensor disposed once"); this.disposed = true; }
  }
  const sessions = [0, 1].map(index => ({ outputNames: ["mask"], async run({ x }) {
    shapes.push(x.dims);
    if (failure === "inference" && index === 1) throw new Error("device lost");
    const values = failure === "nonfinite" ? new Float32Array(x.data.length).fill(NaN) : x.data;
    return { mask: new Tensor("float32", values, x.dims) };
  } }));
  return { ort: { Tensor }, sessions, tensors, shapes };
}

test("Spleeter preserves stereo timing and overlap across model windows and workspace reuse", async () => {
  const workspace = new SpleeterWorkspace(), model = fixture();
  for (const seconds of [16, .2, 12]) {
    const length = Math.round(seconds * 44100);
    const left = Float32Array.from({ length }, (_, i) => Math.sin(2 * Math.PI * i * 16 / 4096) * .2 * Math.min(1, i / 4096, (length - 1 - i) / 4096));
    const right = Float32Array.from(left, value => value * -.7);
    const progress = [];
    const previous = workspace.specReal;
    const { vocals } = await separateSpleeter(model.ort, model.sessions, left, right, value => progress.push(value), workspace);
    assert.equal(vocals.left.length, length);
    assert.equal(vocals.right.length, length);
    let maximum = 0;
    for (let i = 0; i < length; i++) maximum = Math.max(maximum, Math.abs(vocals.left[i] - left[i] / 2), Math.abs(vocals.right[i] - right[i] / 2));
    assert.ok(maximum < .00001, `centered reconstruction without a sample shift: ${maximum}`);
    assert.equal(progress[0], 0, "record inference before the first model run");
    assert.equal(progress.at(-1), 1);
    if (seconds !== 16) assert.equal(workspace.specReal, previous, "shorter windows reuse scratch capacity");
  }
  assert.ok(model.shapes.every(shape => String(shape) === "2,1,512,1024"));
  assert.ok(model.tensors.every(tensor => tensor.disposed));
});

test("Spleeter rejects unbounded input and releases tensors after inference or invalid masks", async () => {
  const pcm = new Float32Array(882);
  for (const failure of ["inference", "nonfinite"]) {
    const model = fixture(failure);
    await assert.rejects(separateSpleeter(model.ort, model.sessions, pcm, pcm), failure === "inference" ? /device lost/ : /Nonfinite/);
    assert.ok(model.tensors.every(tensor => tensor.disposed));
  }
  const model = fixture();
  await assert.rejects(separateSpleeter(model.ort, model.sessions, pcm, new Float32Array(1)), /stereo vocal window/);
  const huge = new Float32Array(16 * 44100 + 1);
  await assert.rejects(separateSpleeter(model.ort, model.sessions, huge, huge), /at most 16 seconds/);
  assert.equal(model.tensors.length, 0, "invalid input cannot allocate inference tensors");
});
