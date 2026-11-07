import { DspChannel, type DspExports } from "./dsp";

// AudioWorkletGlobalScope is not in lib.dom.d.ts.
declare class AudioWorkletProcessor {
  readonly port: MessagePort;
  constructor(options?: unknown);
}
declare function registerProcessor(name: string, ctor: unknown): void;

interface Options {
  processorOptions: { module: WebAssembly.Module };
}

type Message = { type: "params"; gain?: number; coeff?: number } | { type: "dispose" };

class ZigDsp extends AudioWorkletProcessor {
  // Lives as long as the processor, so it is owned by a stack, not a `using` block.
  readonly #resources = new DisposableStack();
  readonly #ch: DspChannel;
  #gain = 0.8;
  #coeff = 0.1;
  #alive = true;

  constructor({ processorOptions }: Options) {
    super();
    const { exports } = new WebAssembly.Instance(processorOptions.module, {});
    this.#ch = this.#resources.use(new DspChannel(exports as unknown as DspExports));
    this.port.onmessage = ({ data }: MessageEvent<Message>) => {
      if (data.type === "dispose") {
        this.#resources.dispose();
        this.#alive = false;
        return;
      }
      this.#gain = data.gain ?? this.#gain;
      this.#coeff = data.coeff ?? this.#coeff;
    };
  }

  process(inputs: Float32Array[][], outputs: Float32Array[][]): boolean {
    const out = outputs[0][0];
    if (!this.#alive || !out) return this.#alive;
    if (inputs[0][0]) out.set(inputs[0][0]);
    else out.fill(0);
    this.#ch.run(out, this.#gain, this.#coeff);
    return true;
  }
}

registerProcessor("zig-dsp", ZigDsp);
