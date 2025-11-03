class PCMProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this._buf = [];
  }
  process(inputs) {
    const input = inputs[0];
    if (input && input[0]) {
      const channelData = input[0]; // Float32Array per 128 frames
      // Send to main thread for downsampling/encoding
      this.port.postMessage(channelData);
    }
    return true; // keep alive
  }
}

registerProcessor('pcm-processor', PCMProcessor);
