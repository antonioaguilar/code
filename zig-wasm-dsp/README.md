# zig-wasm-dsp

A minimal real-time audio DSP module in Zig, compiled to `wasm32-freestanding` and driven from
TypeScript in an AudioWorklet. It is the companion code for the article *Zig for Freestanding
WebAssembly: Tiny, Predictable Modules for Real-Time Audio and Media*. The benchmark reproduces
every number in the article.

- **About 1.1 KB** of `.wasm` (under 700 bytes gzipped), with **zero imports** and no JS glue.
- Heap: `std.heap.wasm_allocator`, which is `std.heap.BrkAllocator` in Zig 0.17.0.
- Allocation happens only at setup. The `process` path never allocates.
- Leak checks run on both sides: native Zig tests use the leak-checking test allocator, and Debug
  wasm builds export `live_allocs` / `live_bytes` for host-side tests.
- TypeScript owns WASM memory through `using` / `DisposableStack`, the host-side equivalent of
  Zig's `defer` / `errdefer`.

## Requirements

- [Zig 0.17.0](https://ziglang.org/download/)
- Node.js 24+ (for the tests, the benchmark and the web build). The host tests import
  `web/dsp.ts` directly and use `using`, both of which need Node 24.
- For the demo: a browser with explicit resource management (`using`, `DisposableStack`), such
  as current Chrome, Edge or Brave.

## Quick start

```bash
git clone https://github.com/antonioaguilar/code.git
cd code/zig-wasm-dsp
zig build test          # native Zig tests: leaks and allocation-failure paths
zig build --release     # zig-out/bin/dsp.wasm (ReleaseSmall, 64 KiB stack)
npm install
npm test                # Zig tests + Debug wasm + host-side leak tests
npm run bench           # reproduces the article's tables
npm run build && npm run serve   # demo at http://localhost:8080
```

Build options:

| Command | Result |
|---|---|
| `zig build` | Debug wasm with `live_allocs` / `live_bytes` exports (large, has debug info) |
| `zig build --release` | ReleaseSmall wasm, about 1.1 KB |
| `zig build --release -Dstack-kib=1024` | Same, with Zig's default 1 MiB stack |

## Layout

```
build.zig               wasm32-freestanding module + native test step
src/main.zig            the WASM ABI: alloc_f32, free_f32, process (+ leak counters in Debug)
src/dsp.zig             allocator-agnostic kernels: process(), Bank (init/deinit with errdefer)
src/CountingAllocator.zig  allocator wrapper that counts live allocations and bytes
src/tests.zig           native tests: std.testing.allocator, checkAllAllocationFailures
test/wasm.test.mjs      host tests on the Debug wasm: no imports, flat memory, `using` frees
bench/bench.mjs         size, imports, memory footprint, slot sizes, 60 s leak simulation
web/dsp.ts              WasmF32 + DspChannel (Disposable) and renderOffline() with `using`
web/worklet.ts          AudioWorkletProcessor owning its channel through a DisposableStack
web/main.ts             compiles the module once on the main thread and hands it to the worklet
```

## The ABI

```zig
export fn alloc_f32(len: usize) ?[*]f32;            // 0 (null) when the heap is exhausted
export fn free_f32(ptr: [*]f32, len: usize) void;   // pass the same len you allocated
export fn process(buf: [*]f32, len: usize, state: *f32, gain: f32, coeff: f32) void;
export fn live_allocs() usize;                      // Debug builds only
export fn live_bytes() usize;                       // Debug builds only
```

Numbers and pointers only: buffers live in linear memory, and the host reads and writes them through
`Float32Array` views of `memory.buffer`.

## Notes

- `std.heap.wasm_allocator` rounds each request up to `ceilPowerOfTwo(len + 4)`, because the last
  word of each slot holds the free-list link. A 512-byte buffer therefore takes a 1,024-byte slot.
  Size hot buffers to `2^n − 4` bytes if that matters to you.
- Each size class you use claims its own 64 KiB page the first time.
- `memory.grow` detaches existing `ArrayBuffer` views. `web/dsp.ts` re-creates its view when
  `memory.buffer` changes.
- `wasm_allocator` is single-threaded. It is a compile error on a multi-threaded build.

## Owning WASM memory from TypeScript

```ts
using ch = new DspChannel(exports); // both allocations freed at scope exit, even on throw
ch.run(block, 0.8, 0.1);
```

- `WasmF32` owns one allocation and frees it in `[Symbol.dispose]()`. Disposing twice is safe.
- `DspChannel` builds itself inside a `using stack = new DisposableStack()` and calls
  `stack.move()` on success, so a constructor that fails halfway frees what it already allocated.
- Long-lived owners (the AudioWorklet processor) hold a `DisposableStack` and dispose it when the
  main thread posts `{ type: "dispose" }`.
