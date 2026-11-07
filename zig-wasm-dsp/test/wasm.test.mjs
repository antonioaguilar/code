// Host-side leak tests against the Debug build, which exports live_allocs / live_bytes.
// Usage: zig build && node --test test/wasm.test.mjs  (Node 24+: runs web/dsp.ts directly)
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DspChannel, WasmF32, renderOffline } from "../web/dsp.ts";

const bytes = readFileSync(new URL("../zig-out/bin/dsp.wasm", import.meta.url));

async function load() {
  const { instance } = await WebAssembly.instantiate(bytes, {});
  return instance.exports;
}

test("module needs no imports", () => {
  assert.deepEqual(WebAssembly.Module.imports(new WebAssembly.Module(bytes)), []);
});

test("process: gain + low-pass in place", async () => {
  const x = await load();
  const buf = x.alloc_f32(128);
  const state = x.alloc_f32(1);
  new Float32Array(x.memory.buffer, state, 1)[0] = 0;
  const view = new Float32Array(x.memory.buffer, buf, 128).fill(1);
  x.process(buf, 128, state, 0.5, 0.1);
  assert.ok(Math.abs(view[0] - 0.05) < 1e-6);
  assert.ok(Math.abs(view[127] - 0.5) < 1e-4);
  x.free_f32(buf, 128);
  x.free_f32(state, 1);
  assert.equal(x.live_allocs(), 0);
  assert.equal(x.live_bytes(), 0);
});

test("steady alloc/free cycles keep memory flat", async () => {
  const x = await load();
  x.free_f32(x.alloc_f32(128), 128); // warm up the size class
  const before = x.memory.buffer.byteLength;
  for (let i = 0; i < 10_000; i++) x.free_f32(x.alloc_f32(128), 128);
  assert.equal(x.memory.buffer.byteLength, before);
  assert.equal(x.live_allocs(), 0);
});

test("a forgotten free shows up in live_allocs", async () => {
  const x = await load();
  x.alloc_f32(128);
  assert.equal(x.live_allocs(), 1);
  assert.equal(x.live_bytes(), 512);
});

test("`using` frees a DspChannel when its scope ends", async () => {
  const x = await load();
  {
    using ch = new DspChannel(x);
    const io = new Float32Array(128).fill(1);
    ch.run(io, 0.5, 0.1);
    assert.ok(Math.abs(io[127] - 0.5) < 1e-4);
    assert.equal(x.live_allocs(), 2);
  }
  assert.equal(x.live_allocs(), 0);
  assert.equal(x.live_bytes(), 0);
});

test("a constructor that fails halfway frees what it allocated", async () => {
  const x = await load();
  let calls = 0;
  const failSecond = { ...x, alloc_f32: (len) => (++calls === 2 ? 0 : x.alloc_f32(len)) };
  assert.throws(() => new DspChannel(failSecond), /heap exhausted/);
  assert.equal(x.live_allocs(), 0);
});

test("disposing twice does not double-free", async () => {
  const x = await load();
  const buf = new WasmF32(x, 128);
  buf[Symbol.dispose]();
  buf[Symbol.dispose]();
  assert.equal(x.live_allocs(), 0);
});

test("renderOffline frees its channel even when processing throws", async () => {
  const x = await load();
  const signal = new Float32Array(1000).fill(1);
  renderOffline(x, signal, 0.5, 0.1);
  assert.ok(Math.abs(signal[999] - 0.5) < 1e-4);
  const boom = { ...x, process: () => { throw new Error("boom"); } };
  assert.throws(() => renderOffline(boom, signal, 0.5, 0.1), /boom/);
  assert.equal(x.live_allocs(), 0);
});
