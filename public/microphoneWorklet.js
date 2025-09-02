// In public/microphoneWorklet.js

class MicrophoneProcessor extends AudioWorkletProcessor {
  process(inputs) {
    const inputChannel = inputs[0] && inputs[0][0];
    if (inputChannel) {
  // Copy samples to a fresh buffer to avoid detaching the internal buffer
  const copy = new Float32Array(inputChannel.length);
  copy.set(inputChannel);
  this.port.postMessage(copy.buffer, [copy.buffer]);
    }
    return true;
  }
}

registerProcessor('microphone-processor', MicrophoneProcessor);
