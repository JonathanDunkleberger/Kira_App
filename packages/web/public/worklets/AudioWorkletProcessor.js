// This runs in a separate, high-priority audio thread.
// Its only job is to capture audio, downsample it, convert it to 16-bit PCM,
// and send it back to the main app.

class Linear16Processor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    this.targetSampleRate = options.processorOptions.targetSampleRate || 16000;
    this.frameCount = 0;
  }

  /**
   * Converts 32-bit Float audio to 16-bit PCM audio (LINEAR16).
   */
  floatTo16BitPCM(input) {
    const output = new Int16Array(input.length);
    for (let i = 0; i < input.length; i++) {
      const s = Math.max(-1, Math.min(1, input[i]));
      output[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
    }
    return output;
  }

  /**
   * A simple (but fast) downsampler.
   */
  downsample(buffer, inputSampleRate, outputSampleRate) {
    if (inputSampleRate === outputSampleRate) {
      return buffer;
    }
    const sampleRateRatio = inputSampleRate / outputSampleRate;
    const newLength = Math.round(buffer.length / sampleRateRatio);
    const result = new Float32Array(newLength);
    let offsetResult = 0;
    let offsetBuffer = 0;
    while (offsetResult < result.length) {
      const nextOffsetBuffer = Math.round((offsetResult + 1) * sampleRateRatio);
      let accum = 0,
        count = 0;
      for (
        let i = offsetBuffer;
        i < nextOffsetBuffer && i < buffer.length;
        i++
      ) {
        accum += buffer[i];
        count++;
      }
      result[offsetResult] = accum / count;
      offsetResult++;
      offsetBuffer = nextOffsetBuffer;
    }
    return result;
  }

  process(inputs) {
    // We only care about the first input (the microphone)
    const input = inputs[0];
    if (input.length === 0 || !input[0]) {
      return true; // Keep the node alive
    }

    // inputs[0][0] is the Float32Array of raw audio data
    const audioData = input[0];

    // 1. Downsample from browser's native rate (sampleRate) to 16000
    const downsampled = this.downsample(
      audioData,
      sampleRate, // This is a global var in the AudioWorklet scope
      this.targetSampleRate
    );

    // 2. Convert to 16-bit PCM (this is the crucial step)
    const pcmData = this.floatTo16BitPCM(downsampled);

    // 3. Calculate RMS BEFORE transferring the buffer
    //    (postMessage with transferable detaches the ArrayBuffer, making pcmData empty)
    this.frameCount++;
    let rms = 0;
    if (this.frameCount % 100 === 0) {
      let sum = 0;
      for (let i = 0; i < pcmData.length; i++) {
        sum += pcmData[i] * pcmData[i];
      }
      rms = pcmData.length > 0 ? Math.sqrt(sum / pcmData.length) : 0;
    }

    // 4. Send the raw PCM ArrayBuffer back to the main thread (transfers ownership)
    this.port.postMessage(pcmData.buffer, [pcmData.buffer]);

    // 5. Send debug info AFTER transfer (uses pre-computed rms)
    if (this.frameCount % 100 === 0) {
      this.port.postMessage({
        type: "debug",
        message: `RMS: ${rms.toFixed(0)} | Frame: ${this.frameCount} | VAD threshold: 1500`
      });
    }

    return true; // Tell the browser we're still processing
  }
}

registerProcessor("audio-worklet-processor", Linear16Processor);
