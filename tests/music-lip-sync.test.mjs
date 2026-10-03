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


function richFixture(bound = true) {
  const ids=["ParamMouthOpenY","ParamMouthForm","Mouthfunnel","MouthPuckerWiden","Jawopen","smile"], values=[0,0,0,0,0,.5];
  const vertices=new Float32Array(3);
  const model={
    getParameterIndex:id=>ids.includes(id)?ids.indexOf(id):ids.length,
    getParameterCount:()=>ids.length,
    getParameterMinimumValue:i=>i===1||i===3?-1:0,
    getParameterMaximumValue:()=>1,
    getParameterDefaultValue:i=>i===5?.5:0,
    getParameterValueByIndex:i=>values[i],
    setParameterValueByIndex:(i,v)=>{values[i]=v},
    getDrawableCount:()=>1, getDrawableVertices:()=>vertices,
    update:()=>{if(bound)vertices.set(values.slice(2,5))},
  };
  return {values,sync:new MusicLipSync(model,[ids[0]],"hong-xi")};
}

test("bound Hong Xi channels distinguish vowels and return to neutral on pause",()=>{
  const {values,sync}=richFixture();
  assert.deepEqual(values,[0,0,0,0,0,.5],"capability probe restores every parameter");
  const shapes=[];
  for(let vowel=0;vowel<5;vowel++) {
    sync.update({open:.8,form:0,vowels:Array.from({length:5},(_,i)=>Number(i===vowel))},true,1);
    shapes.push(values.slice(2,5));
    assert.ok(Math.abs(values[4]-.8)<1e-6,"jaw amplitude follows energy for every vowel");
    assert.equal(values[0],0,"only one jaw channel drives aperture");
    assert.equal(values[5],.5);
  }
  assert.ok(shapes[2][1]>0 && shapes[3][1]<0 && shapes[4][1]<shapes[3][1]);
  assert.ok(shapes[3][0]>0 && shapes[4][0]>shapes[3][0]);
  sync.update({open:1,form:0,vowels:[1,0,0,0,0]},false,1);
  assert.deepEqual(values.slice(2,5),[0,0,0]);
});

test("unbound declared channels retain the two-axis mouth; legacy poses stay generic",()=>{
  const {values,sync}=richFixture(false);
  sync.update({open:.8,form:-.8,vowels:[0,0,0,1,0]},true,1);
  assert.ok(values[0]>.79);assert.deepEqual(values.slice(2,5),[0,0,0]);
  const rich=richFixture();rich.sync.update({open:.8,form:.5},true,1);
  assert.ok(rich.values[0]>.79); assert.deepEqual(rich.values.slice(2,5),[0,0,0]);
});
