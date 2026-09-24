import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

const source = await readFile(new URL("../src/live2d/hongXiPersonality.ts", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
const { HONG_XI_GESTURES, sampleHongXiGesture, HongXiPersonality } = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString("base64")}`);
const defaults = { dt: 1 / 60, playing: false, welcome: false, energy: 0.6, beatCount: 0 };

test("all personality gestures ease out to neutral and stay inside the model's authored ranges", async () => {
  const info = JSON.parse(await readFile(new URL("../public/live2d/hong-xi/yuql216.cdi3.json", import.meta.url), "utf8"));
  const ids = new Set(info.Parameters.map(({ Id }) => Id));
  for (const [name, frames] of Object.entries(HONG_XI_GESTURES)) {
    const duration = frames.at(-1)[0];
    assert.deepEqual(sampleHongXiGesture(name, 0), {});
    assert.deepEqual(sampleHongXiGesture(name, duration), {});
    let previous = {};
    for (let time = 0; time <= duration + 1 / 60; time += 1 / 60) {
      const pose = sampleHongXiGesture(name, time);
      for (const [id, value] of Object.entries(pose)) {
        assert.ok(ids.has(id) || id === "eyesClosed", `${id} exists in Hong Xi`);
        assert.ok(Number.isFinite(value));
        const limit = /Angle|Rotation/u.test(id) ? 30 : 1;
        assert.ok(Math.abs(value) <= limit, `${id} respects range`);
        assert.ok(Math.abs(value - (previous[id] ?? 0)) < 1.5, `${name}/${id} has no frame discontinuity`);
      }
      previous = pose;
    }
  }
});

test("automatic listening covers varied gestures without consecutive repeats and leaves quiet gaps", () => {
  const director = new HongXiPersonality(() => 0.45);
  const gestures = [];
  let previous = null;
  let gap = 0;
  for (let frame = 0; frame < 180 * 60; frame++) {
    director.update({ ...defaults, playing: true, beatCount: Math.floor(frame / 30) });
    if (director.gesture && director.gesture !== previous) {
      if (gestures.length) assert.ok(gap >= 2.4);
      gestures.push(director.gesture);
      gap = 0;
    }
    if (!director.gesture) gap += defaults.dt;
    previous = director.gesture;
  }
  assert.equal(new Set(gestures).size, 5);
  assert.ok(gestures.every((id, index) => index === 0 || gestures[index - 1] !== id));
});

test("pausing releases expression and pose smoothly, then remains still", () => {
  const director = new HongXiPersonality();
  director.react();
  let previous = {};
  for (let i = 0; i < 90; i++) previous = director.update({ ...defaults, playing: true });
  assert.ok(Object.values(previous).some((value) => Math.abs(value) > 0.1));
  const firstPaused = director.update(defaults);
  for (const [id, value] of Object.entries(firstPaused)) assert.ok(Math.abs(value - (previous[id] ?? 0)) < 0.02);
  let pose;
  for (let i = 0; i < 600; i++) pose = director.update(defaults);
  assert.ok(Object.values(pose).every((value) => Math.abs(value) < 0.001));
  assert.equal(director.gesture, null);
});

test("manual reactions work while paused and repeated clicks queue only one reaction", () => {
  const director = new HongXiPersonality();
  director.react();
  director.update(defaults);
  assert.equal(director.gesture, "hello");
  for (let i = 0; i < 100; i++) director.react();
  for (let i = 0; i < 8 * 60; i++) director.update(defaults);
  assert.equal(director.gesture, null);
  director.react();
  director.update(defaults);
  assert.equal(director.gesture, "sparkle");
});

test("quiet music never uses star eyes or negative expression switches", () => {
  const director = new HongXiPersonality(() => 0.7);
  for (let i = 0; i < 180 * 60; i++) {
    const pose = director.update({ ...defaults, playing: true, energy: 0.1, beatCount: Math.floor(i / 30) });
    assert.notEqual(director.gesture, "sparkle");
    assert.equal(pose.Param32 || 0, 0);
    assert.equal(pose.Param30, undefined);
    assert.equal(pose.Param33, undefined);
    assert.equal(pose.Param23, undefined);
  }
});
