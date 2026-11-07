// Reproduces every number in the article: module size, imports, linear-memory footprint
// with a 1 MiB vs 64 KiB stack, footprint after 10,000 alloc/free cycles, and slot sizes.
// Usage: node bench/bench.mjs   (needs zig 0.17.0 on PATH)
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { gzipSync } from "node:zlib";

const KiB = 1024;
const FRAMES = 128;
const CYCLES = 10_000;

function build(stackKib) {
  const prefix = `zig-out/stack-${stackKib}`;
  execFileSync("zig", ["build", "--release", `-Dstack-kib=${stackKib}`, "--prefix", prefix]);
  return readFileSync(`${prefix}/bin/dsp.wasm`);
}

async function instantiate(bytes) {
  const module = new WebAssembly.Module(bytes);
  const { exports } = await WebAssembly.instantiate(module, {});
  return { module, x: exports };
}

const kib = (x) => x.memory.buffer.byteLength / KiB;

console.log("| Stack | .wasm bytes | gzip -9 | Imports | Memory at start | After 10k cycles |");
console.log("|---|---|---|---|---|---|");
for (const stackKib of [1024, 64]) {
  const bytes = build(stackKib);
  const { module, x } = await instantiate(bytes);
  const start = kib(x);
  for (let i = 0; i < CYCLES; i++) x.free_f32(x.alloc_f32(FRAMES), FRAMES);
  const gz = gzipSync(bytes, { level: 9 }).length;
  const imports = WebAssembly.Module.imports(module).length;
  console.log(`| ${stackKib} KiB | ${bytes.length} | ${gz} | ${imports} | ${start} KiB | ${kib(x)} KiB |`);
}

// Slot size = distance between two consecutive allocations of the same size.
const { x } = await instantiate(build(64));
console.log("\n| Requested bytes | Slot bytes |");
console.log("|---|---|");
for (const frames of [127, 128, 255, 256]) {
  const a = x.alloc_f32(frames);
  const b = x.alloc_f32(frames);
  console.log(`| ${frames * 4} | ${b - a} |`);
}

// One minute of a 44.1 kHz AudioWorklet (128-frame callbacks), with and without a leak:
// each callback allocates a 128-frame scratch buffer; the leaky one never frees it.
const SAMPLE_RATE = 44_100;
const callbacksPerSecond = SAMPLE_RATE / FRAMES;
const MiB = KiB * KiB;
const correct = (await instantiate(build(64))).x;
const leaky = (await instantiate(build(64))).x;
console.log("\n| Seconds | Correct (MiB) | Leaky (MiB) |");
console.log("|---|---|---|");
for (let s = 0, done = 0; s <= 60; s += 10) {
  for (; done < Math.round(s * callbacksPerSecond); done++) {
    correct.free_f32(correct.alloc_f32(FRAMES), FRAMES);
    leaky.alloc_f32(FRAMES);
  }
  const mib = (x) => (x.memory.buffer.byteLength / MiB).toFixed(2);
  console.log(`| ${s} | ${mib(correct)} | ${mib(leaky)} |`);
}
