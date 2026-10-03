import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

const source = await readFile(new URL("../src/live2d/musicLipSync.ts", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
const { MusicLipSync } = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString("base64")}`);
const context = vm.createContext({ console, WebAssembly, TextDecoder, TextEncoder, Uint8Array, ArrayBuffer, setTimeout, clearTimeout, atob, btoa });
vm.runInContext(await readFile(new URL("../public/live2d/live2dcubismcore.min.js", import.meta.url), "utf8"), context);
const bytes = await readFile(new URL("../public/live2d/hong-xi/yuql216.moc3", import.meta.url));
const mouthIds = ["ArtMesh149", "ArtMesh148", "ArtMesh147", "ArtMesh146", "ArtMesh145", "ArtMesh140", "ArtMesh139", "ArtMesh42"];

function rig() {
  const moc = context.Live2DCubismCore.Moc.fromArrayBuffer(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
  const model = context.Live2DCubismCore.Model.fromMoc(moc), p = model.parameters;
  const bridge = {
    getParameterIndex: id => p.ids.indexOf(id),
    getParameterCount: () => p.count,
    getParameterMinimumValue: i => p.minimumValues[i],
    getParameterMaximumValue: i => p.maximumValues[i],
    getParameterDefaultValue: i => p.defaultValues[i],
    getParameterValueByIndex: i => p.values[i],
    setParameterValueByIndex: (i, v) => { p.values[i] = v; },
    getDrawableCount: () => model.drawables.count,
    getDrawableVertices: i => model.drawables.vertexPositions[i],
    update: () => model.update(),
  };
  const sync = new MusicLipSync(bridge, ["ParamMouthOpenY"], "hong-xi");
  return { model, p, sync, release: () => { model.release(); moc._release(); } };
}
const vowelPose = (i, open = .8) => ({ open, form: [.15, .5, 1, -.8, -1][i], vowels: Array.from({ length: 5 }, (_, j) => Number(i === j)) });

test("calibrated vowels produce distinct mouth meshes in the shipped Hong Xi moc3", () => {
  const { model, p, sync, release } = rig();
  try {
    const shapes = [];
    for (let vowel = 0; vowel < 5; vowel++) {
      p.values.set(p.defaultValues);
      sync.update(vowelPose(vowel), true, 1);
      model.update();
      shapes.push(mouthIds.flatMap(id => Array.from(model.drawables.vertexPositions[model.drawables.ids.indexOf(id)])));
      for (let i = 0; i < p.count; i++) {
        if (!["ParamMouthForm", "ParamMouthOpenY"].includes(p.ids[i])) assert.equal(p.values[i], p.defaultValues[i], `preserve ${p.ids[i]}`);
      }
    }
    for (let a = 0; a < 5; a++) for (let b = a + 1; b < 5; b++) {
      const difference = Math.max(...shapes[a].map((v, i) => Math.abs(v - shapes[b][i])));
      assert.ok(difference > .001, `vowels ${a}/${b} change actual mouth geometry (${difference})`);
    }
  } finally { release(); }
});

test("Hong Xi I/U stay shallower than AA/O and retain energy-confirmed closures", () => {
  const { p, sync, release } = rig();
  try {
    const openIndex = p.ids.indexOf("ParamMouthOpenY"), apertures = [];
    for (let i = 0; i < 5; i++) {
      sync.update(vowelPose(i), true, 1);
      apertures.push(p.values[openIndex]);
    }
    assert.ok(apertures[2] < apertures[1] && apertures[1] < apertures[0]);
    assert.ok(apertures[4] < apertures[3] * .65);
    sync.update(vowelPose(3, 0), true, .06);
    assert.ok(p.values[openIndex] < .04, "rounded vowels cannot hold open through a bilabial closure");
    sync.update(vowelPose(3, 1), true, 1);
    assert.ok(p.values[openIndex] <= p.maximumValues[openIndex], "rounded aperture stays within rig range");
    sync.update(vowelPose(3), false, 1);
    assert.equal(p.values[openIndex], 0, "pause closes the mouth even with stale vowels");
  } finally { release(); }
});

test("Hong Xi blends remain continuous across vowels and recover legacy poses", () => {
  const { p, sync, release } = rig();
  try {
    const formIndex = p.ids.indexOf("ParamMouthForm"), openIndex = p.ids.indexOf("ParamMouthOpenY");
    const values = [];
    for (const blend of [0, .25, .5, .75, 1]) {
      sync.update({ open: .8, form: 0, vowels: [0, 0, 1 - blend, blend, 0] }, true, 1);
      values.push([p.values[formIndex], p.values[openIndex]]);
    }
    for (let i = 1; i < values.length; i++) {
      assert.ok(values[i][0] < values[i - 1][0]);
      assert.ok(values[i][1] > values[i - 1][1]);
    }
    for (const vowels of [undefined, [0, 0, 0, 0, 0], [NaN, 0, 0, 0, 0]]) {
      sync.update({ open: .8, form: .5, vowels }, true, 1);
      assert.ok(Math.abs(p.values[openIndex] - .8) < 1e-6);
      assert.ok(Math.abs(p.values[formIndex] - .5) < 1e-6);
    }
  } finally { release(); }
});

test("calibrated Hong Xi vowels preserve restrained consonant accents without changing aperture", () => {
  const { p, sync, release } = rig();
  try {
    const formIndex = p.ids.indexOf("ParamMouthForm"), openIndex = p.ids.indexOf("ParamMouthOpenY");
    sync.update(vowelPose(2), true, 1);
    const vowelForm = p.values[formIndex], aperture = p.values[openIndex];
    sync.update({ ...vowelPose(2), form: .55 }, true, 1);
    assert.ok(p.values[formIndex] < vowelForm && p.values[formIndex] >= vowelForm - .201);
    assert.equal(p.values[openIndex], aperture);
  } finally { release(); }
});
