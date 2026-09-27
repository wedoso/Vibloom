import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

const source = await readFile(new URL("../src/platform/mediaSession.ts", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
const { bindMediaSession, updateMediaPosition } = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString("base64")}`);

test("routes explicit headset commands, tolerates unsupported actions and cleans up", async () => {
  const handlers = new Map();
  const calls = [];
  const session = {
    setActionHandler(action, handler) { if (action === "seekforward") throw new Error("unsupported"); handlers.set(action, handler); },
    setPositionState(value) { this.position = value; },
    metadata: { title: "Song" }, playbackState: "playing",
  };
  const detach = bindMediaSession(session, {
    play: () => { calls.push("play"); }, pause: () => { calls.push("pause"); },
    next: () => { calls.push("next"); }, previous: () => { calls.push("previous"); },
    seek: (time) => { calls.push(time); }, getTime: () => 20, onError: () => { calls.push("error"); },
  });
  handlers.get("play")({}); handlers.get("pause")({}); handlers.get("pause")({});
  assert.deepEqual(calls, ["play", "pause", "pause"], "commands run in arrival order, never toggle");
  handlers.get("seekbackward")({seekOffset: 3}); handlers.get("seekto")({seekTime: 8.5});
  handlers.get("seekto")({seekTime: NaN}); handlers.get("seekto")({});
  handlers.get("nexttrack")({}); handlers.get("previoustrack")({}); handlers.get("stop")({});
  assert.deepEqual(calls.slice(3), [17, 8.5, "next", "previous", "pause"]);
  detach();
  assert.ok([...handlers.values()].every((handler) => handler === null));
  assert.equal(session.playbackState, "none"); assert.equal(session.metadata, null);
  assert.equal(session.position, undefined);
});

test("publishes safe playback positions and handles asynchronous control failures", async () => {
  const positions = [];
  const session = { setPositionState: (value) => positions.push(value) };
  for (const [duration, position] of [[120, 13.25], [120, 130], [120, -3], [120, NaN], [0, 0], [Infinity, 2]]) updateMediaPosition(session, duration, position);
  assert.deepEqual(positions, [
    { duration: 120, playbackRate: 1, position: 13.25 },
    { duration: 120, playbackRate: 1, position: 120 },
    { duration: 120, playbackRate: 1, position: 0 },
    { duration: 120, playbackRate: 1, position: 0 }, undefined, undefined,
  ]);
  updateMediaPosition({}, 10, 3);
  let play;
  let errors = 0;
  bindMediaSession({ setActionHandler: (action, handler) => { if (action === "play") play = handler; } }, {
    play: async () => { throw new Error("device disconnected"); }, onError: () => { errors++; },
  });
  play({}); await new Promise((resolve) => setImmediate(resolve));
  assert.equal(errors, 1);
});

test("silent media carrier remains resumable when paused and releases resources on teardown", async (t) => {
  const anchorSource = await readFile(new URL("../src/platform/mediaSessionAnchor.ts", import.meta.url), "utf8");
  const compiled = ts.transpileModule(anchorSource, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
  const { createMediaSessionAnchor } = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString("base64")}`);
  const originalAudio = globalThis.Audio;
  const audios = [];
  class FakeAudio extends EventTarget {
    paused = true;
    constructor(src) { super(); this.src = src; audios.push(this); }
    async play() { this.paused = false; this.dispatchEvent(new Event("play")); }
    pause() { this.paused = true; this.dispatchEvent(new Event("pause")); }
    removeAttribute(name) { delete this[name]; }
    load() {}
  }
  globalThis.Audio = FakeAudio;
  t.after(() => { if (originalAudio === undefined) delete globalThis.Audio; else globalThis.Audio = originalAudio; });
  const commands = [];
  const anchor = createMediaSessionAnchor(() => commands.push("play"), () => commands.push("pause"), () => commands.push("error"));
  const audio = audios[0];
  const blobUrl = audio.src;
  const bytes = await (await fetch(blobUrl)).arrayBuffer();
  assert.equal(new DataView(bytes).getUint32(40, true), 80000);
  assert.ok(new Uint8Array(bytes, 44).every((sample) => sample === 128), "carrier is digital silence");
  anchor.setPlaying(true); anchor.setPlaying(false);
  assert.deepEqual(commands, [], "app-initiated changes do not echo as system commands");
  assert.equal(audio.src, blobUrl, "pause keeps the media resource for OS resume");
  await audio.play();
  assert.deepEqual(commands, ["play"]);
  anchor.setPlaying(true); audio.pause();
  assert.deepEqual(commands, ["play", "pause"]);
  anchor.dispose();
  await audio.play();
  assert.deepEqual(commands, ["play", "pause"], "listeners removed on teardown");
  assert.equal(audio.src, undefined);
  await assert.rejects(fetch(blobUrl));
});
