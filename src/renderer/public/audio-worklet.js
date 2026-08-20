/**
 * AudioWorklet processor：抓麥克風 PCM，累積成 100ms chunks 推送
 *
 * 用法（renderer）：
 *   await audioContext.audioWorklet.addModule('/audio-worklet.js');
 *   const source = audioContext.createMediaStreamSource(stream);
 *   const node = new AudioWorkletNode(audioContext, 'audio-capture-processor');
 *   source.connect(node);
 *   node.port.onmessage = (e) => { ... };
 *
 * Chunk 規格：16kHz mono Float32，每 1600 frames = 100ms
 * Float32Array 走 transferable 零拷貝。
 */

class AudioCaptureProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.bufferSize = 1600; // 100ms @ 16kHz
    this.buffer = new Float32Array(this.bufferSize);
    this.bufferIndex = 0;
    this.chunksSent = 0;
  }

  process(inputs) {
    const input = inputs[0];
    if (!input || input.length === 0) return true;

    const channel = input[0];
    if (!channel || channel.length === 0) return true;

    for (let i = 0; i < channel.length; i++) {
      this.buffer[this.bufferIndex++] = channel[i];

      if (this.bufferIndex >= this.bufferSize) {
        // 複製 buffer（worklet 內部會重用 this.buffer）
        const out = new Float32Array(this.buffer);
        this.port.postMessage({ samples: out }, [out.buffer]);
        this.chunksSent++;
        this.bufferIndex = 0;
      }
    }
    return true;
  }
}

registerProcessor('audio-capture-processor', AudioCaptureProcessor);
