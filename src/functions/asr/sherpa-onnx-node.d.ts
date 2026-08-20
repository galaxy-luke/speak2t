/**
 * sherpa-onnx-node ambient declaration
 *
 * sherpa-onnx-node 套件本身沒有 .d.ts，這裡給出最常用 API 的型別。
 * 完整 API 參考：https://github.com/k2-fsa/sherpa-onnx/tree/master/nodejs-examples
 */

declare module 'sherpa-onnx-node' {
  export interface OnlineRecognizerConfig {
    featConfig?: {
      sampleRate: number;
      featureDim: number;
    };
    modelConfig: {
      transducer?: {
        encoder: string;
        decoder: string;
        joiner: string;
      };
      paraformer?: {
        encoder: string;
        decoder: string;
      };
      nemo?: { model: string };
      tokens: string;
      numThreads?: number;
      provider?: 'cpu' | 'cuda' | 'coreml';
      debug?: boolean;
      modelType?: string;
    };
    lmConfig?: {
      model: string;
      scale?: number;
    };
    enableEndpoint?: boolean;
    rule1MinTrailingSilence?: number;
    rule2MinTrailingSilence?: number;
    rule3MinUtteranceLength?: number;
    decodingMethod?: 'greedy_search' | 'modified_beam_search';
  }

  export interface OnlineRecognizerResult {
    text: string;
    tokens?: string[];
    timestamps?: number[];
  }

  export class OnlineRecognizer {
    constructor(config: OnlineRecognizerConfig);
    readonly config: { featConfig: { sampleRate: number; featureDim: number } };
    createStream(): OnlineStream;
    isReady(stream: OnlineStream): boolean;
    decode(stream: OnlineStream): void;
    getResult(stream: OnlineStream): OnlineRecognizerResult;
    isEndpoint(stream: OnlineStream): boolean;
    reset(stream: OnlineStream): void;
    free(): void;
  }

  export class OnlineStream {
    acceptWaveform(sampleRate: number, samples: Float32Array): void;
    inputFinished(): void;
    free(): void;
  }

  export class OfflineRecognizer {
    constructor(config: OnlineRecognizerConfig);
    createStream(): OfflineStream;
    decode(stream: OfflineStream): OfflineRecognizerResult;
    free(): void;
  }

  export class OfflineStream {
    acceptWaveform(sampleRate: number, samples: Float32Array): void;
    free(): void;
  }

  export class OfflineTts {
    constructor(config: unknown);
    generate(text: string, opts?: unknown): { samples: Float32Array; sampleRate: number };
    free(): void;
  }

  export class GenerationConfig {
    constructor(opts?: unknown);
  }

  export class Display {
    constructor(opts?: unknown);
    print(text: string): void;
  }

  export class Vad {
    constructor(config: unknown);
    acceptWaveform(samples: Float32Array): void;
    isSpeech(): boolean;
    front(): { sample: number; start: number };
    flush(): void;
    reset(): void;
    free(): void;
  }

  export class CircularBuffer {
    constructor(capacity: number);
    readonly capacity: number;
    readonly size: number;
    readonly head: number;
    push(samples: Float32Array): void;
    get(start: number, n: number): Float32Array;
    read(n: number): Float32Array;
    reset(): void;
  }

  export class SpokenLanguageIdentification {
    constructor(config: unknown);
    acceptWaveform(samples: Float32Array): void;
    isReady(): boolean;
    decode(): { lang: string };
    free(): void;
  }

  export class SpeakerEmbeddingExtractor {
    constructor(config: unknown);
    createStream(): unknown;
    acceptWaveform(stream: unknown, samples: Float32Array): void;
    compute(stream: unknown): Float32Array;
    free(): void;
  }

  export class SpeakerEmbeddingManager {
    constructor(dim: number);
    add(name: string, embedding: Float32Array): void;
    remove(name: string): void;
    search(embedding: Float32Array, threshold: number): string;
    free(): void;
  }

  export class AudioTagging {
    constructor(config: unknown);
    createStream(): unknown;
    acceptWaveform(stream: unknown, samples: Float32Array): void;
    compute(stream: unknown): Array<{ name: string; prob: number }>;
    free(): void;
  }

  export class OfflinePunctuation {
    constructor(config: unknown);
    addPunctuation(text: string): string;
    free(): void;
  }

  export class OnlinePunctuation {
    constructor(config: unknown);
    addPunctuation(text: string): string;
    free(): void;
  }

  export class KeywordSpotter {
    constructor(config: unknown);
    createStream(): unknown;
    acceptWaveform(stream: unknown, samples: Float32Array): void;
    isReady(stream: unknown): boolean;
    decode(stream: unknown): { keyword: string };
    free(): void;
  }

  export class OfflineSpeakerDiarization {
    constructor(config: unknown);
    process(samples: Float32Array): unknown;
    free(): void;
  }

  export class OfflineSpeechDenoiser {
    constructor(config: unknown);
    run(samples: Float32Array, sampleRate: number): { samples: Float32Array; sampleRate: number };
    free(): void;
  }

  export class OnlineSpeechDenoiser {
    constructor(config: unknown);
    createStream(): unknown;
    acceptWaveform(stream: unknown, samples: Float32Array): void;
    flush(stream: unknown): { samples: Float32Array; sampleRate: number };
    free(): void;
  }

  export class LinearResampler {
    constructor(inputSampleRate: number, outputSampleRate: number);
    reset(): void;
    resample(samples: Float32Array, flush: boolean): Float32Array;
    free(): void;
  }

  export function readWave(filename: string): { samples: Float32Array; sampleRate: number };
  export function writeWave(
    filename: string,
    samples: Float32Array,
    sampleRate: number,
  ): void;

  const sherpa_onnx: {
    OnlineRecognizer: typeof OnlineRecognizer;
    OfflineRecognizer: typeof OfflineRecognizer;
    OfflineTts: typeof OfflineTts;
    GenerationConfig: typeof GenerationConfig;
    readWave: typeof readWave;
    writeWave: typeof writeWave;
    Display: typeof Display;
    Vad: typeof Vad;
    CircularBuffer: typeof CircularBuffer;
    SpokenLanguageIdentification: typeof SpokenLanguageIdentification;
    SpeakerEmbeddingExtractor: typeof SpeakerEmbeddingExtractor;
    SpeakerEmbeddingManager: typeof SpeakerEmbeddingManager;
    AudioTagging: typeof AudioTagging;
    OfflinePunctuation: typeof OfflinePunctuation;
    OnlinePunctuation: typeof OnlinePunctuation;
    KeywordSpotter: typeof KeywordSpotter;
    OfflineSpeakerDiarization: typeof OfflineSpeakerDiarization;
    OfflineSpeechDenoiser: typeof OfflineSpeechDenoiser;
    OnlineSpeechDenoiser: typeof OnlineSpeechDenoiser;
    LinearResampler: typeof LinearResampler;
  };

  export default sherpa_onnx;
}
