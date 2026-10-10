import assert from "node:assert/strict";
import test from "node:test";
import { loadTs } from "./load-ts.mjs";

const { bindMobileViewport } = await loadTs("../src/mobile/viewport.ts");

function environment(t, { innerHeight = 376, height = 376, offsetTop = 0, scale = 1 } = {}) {
  const saved = Object.fromEntries(["window", "document", "HTMLElement", "requestAnimationFrame"].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  const frame = [], properties = new Map(), classes = new Set();
  class Element extends EventTarget {
    style = { setProperty: (key, value) => properties.set(key, value), removeProperty: key => properties.delete(key) };
    classList = { toggle: (key, value) => value ? classes.add(key) : classes.delete(key), remove: key => classes.delete(key) };
    contains = () => true;
  }
  const root = new Element(), viewport = Object.assign(new EventTarget(), { height, offsetTop, scale });
  globalThis.window = Object.assign(new EventTarget(), { innerHeight });
  globalThis.document = { activeElement: null };
  globalThis.HTMLElement = Element;
  globalThis.requestAnimationFrame = fn => { frame.push(fn); return frame.length; };
  t.after(() => { for (const [key, descriptor] of Object.entries(saved)) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key]; } });
  const flush = () => { while (frame.length) frame.shift()(); };
  const cleanup = bindMobileViewport(root, viewport);
  flush();
  return { root, viewport, properties, classes, Element, flush, cleanup };
}

test("a panned iPhone keyboard leaves the dialog inside the visible 88px viewport", t => {
  const { properties, classes, cleanup } = environment(t, { innerHeight: 229, height: 88, offsetTop: 147 });
  const bottom = Number.parseFloat(properties.get("--m-vv-bottom"));
  const dialogHeight = 76;
  assert.equal(229 - bottom - dialogHeight, 12);
  assert.equal(229 - bottom, 88);
  assert.ok(classes.has("has-compact-keyboard"));
  cleanup();
});

test("dismissing the keyboard and rotating restores full height and releases viewport listeners", t => {
  const { viewport, properties, classes, flush, cleanup } = environment(t, { innerHeight: 440, height: 210 });
  assert.equal(properties.get("--m-vv-bottom"), "230px");
  viewport.height = 440;
  viewport.dispatchEvent(new Event("resize"));
  flush();
  assert.equal(properties.get("--m-vv-height"), "440px");
  assert.equal(properties.get("--m-vv-bottom"), "0px");
  assert.equal(classes.has("has-compact-keyboard"), false);
  cleanup();
  viewport.height = 100;
  viewport.dispatchEvent(new Event("scroll"));
  globalThis.window.dispatchEvent(new Event("resize"));
  assert.equal(properties.size, 0);
  assert.equal(classes.size, 0);
});

test("keyboard focus scrolls the editor body without panning the page or the dialog", t => {
  const { viewport, Element, flush, cleanup } = environment(t);
  const scroller = { scrollTop: 40, getBoundingClientRect: () => ({ top: 12, bottom: 76 }) };
  const field = new Element();
  field.matches = () => true;
  field.closest = () => scroller;
  field.getBoundingClientRect = () => ({ top: 66, bottom: 110 });
  field.scrollIntoView = () => assert.fail("must not scroll the window");
  globalThis.document.activeElement = field;
  viewport.dispatchEvent(new Event("resize"));
  flush();
  assert.equal(scroller.scrollTop, 74);
  field.getBoundingClientRect = () => ({ top: 0, bottom: 44 });
  viewport.dispatchEvent(new Event("scroll"));
  flush();
  assert.equal(scroller.scrollTop, 62);
  cleanup();
});

test("pinch zoom does not activate the compact keyboard layout", t => {
  const { classes, cleanup } = environment(t, { height: 180, scale: 2 });
  assert.equal(classes.has("has-compact-keyboard"), false);
  cleanup();
});
