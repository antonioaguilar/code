let ctx: AudioContext | undefined;

async function start(): Promise<AudioWorkletNode> {
  ctx = new AudioContext();
  await ctx.audioWorklet.addModule("./worklet.js");
  // Compile once on the main thread; a WebAssembly.Module can be structured-cloned.
  const module = await WebAssembly.compile(await (await fetch("./dsp.wasm")).arrayBuffer());
  const node = new AudioWorkletNode(ctx, "zig-dsp", { processorOptions: { module } });

  const osc = new OscillatorNode(ctx, { type: "sawtooth", frequency: 110 });
  osc.connect(node).connect(ctx.destination);
  osc.start();
  return node;
}

const button = document.querySelector<HTMLButtonElement>("#toggle")!;
const cutoff = document.querySelector<HTMLInputElement>("#cutoff")!;
let node: AudioWorkletNode | undefined;

button.onclick = async () => {
  if (ctx) {
    node?.port.postMessage({ type: "dispose" }); // free the channel before tearing down
    await ctx.close();
    ctx = node = undefined;
    button.textContent = "Start";
    return;
  }
  node = await start();
  button.textContent = "Stop";
};

cutoff.oninput = () => node?.port.postMessage({ type: "params", coeff: Number(cutoff.value) });
