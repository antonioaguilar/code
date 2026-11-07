/** The module's exports. `live_allocs` / `live_bytes` exist in Debug builds only. */
export interface DspExports {
  memory: WebAssembly.Memory;
  alloc_f32(len: number): number;
  free_f32(ptr: number, len: number): void;
  process(buf: number, len: number, state: number, gain: number, coeff: number): void;
  live_allocs?(): number;
  live_bytes?(): number;
}

/** One f32 allocation in linear memory, freed when its `using` scope ends. */
export class WasmF32 implements Disposable {
  readonly #x: DspExports;
  readonly ptr: number;
  readonly len: number;
  #live = true;

  constructor(x: DspExports, len: number) {
    const ptr = x.alloc_f32(len);
    if (ptr === 0) throw new Error("wasm heap exhausted");
    this.#x = x;
    this.ptr = ptr;
    this.len = len;
  }

  /** A fresh view: views are cheap, and memory.grow detaches old ones. */
  view(): Float32Array {
    return new Float32Array(this.#x.memory.buffer, this.ptr, this.len);
  }

  [Symbol.dispose](): void {
    if (!this.#live) return;
    this.#live = false;
    this.#x.free_f32(this.ptr, this.len);
  }
}

/** One channel: a frame buffer and a filter state, allocated once, freed on dispose. */
export class DspChannel implements Disposable {
  readonly #x: DspExports;
  readonly frames: number;
  readonly #buf: WasmF32;
  readonly #state: WasmF32;
  readonly #owned: DisposableStack;
  #view: Float32Array;

  constructor(x: DspExports, frames = 128) {
    // If anything below throws, `using` frees what was already allocated: TypeScript's errdefer.
    using stack = new DisposableStack();
    this.#buf = stack.use(new WasmF32(x, frames));
    this.#state = stack.use(new WasmF32(x, 1));
    this.#state.view()[0] = 0; // reused slots are not zeroed
    this.#x = x;
    this.frames = frames;
    this.#view = this.#buf.view();
    this.#owned = stack.move(); // success: the channel now owns both allocations
  }

  /** Processes `io` in place. Never allocates. */
  run(io: Float32Array, gain: number, coeff: number): void {
    if (this.#view.buffer !== this.#x.memory.buffer) this.#view = this.#buf.view();
    this.#view.set(io);
    this.#x.process(this.#buf.ptr, io.length, this.#state.ptr, gain, coeff);
    io.set(this.#view.subarray(0, io.length));
  }

  [Symbol.dispose](): void {
    this.#owned.dispose();
  }
}

/** Processes a whole signal in place, block by block. The channel is freed on return or throw. */
export function renderOffline(x: DspExports, signal: Float32Array, gain: number, coeff: number) {
  using ch = new DspChannel(x);
  for (let i = 0; i < signal.length; i += ch.frames) {
    ch.run(signal.subarray(i, i + ch.frames), gain, coeff);
  }
}
