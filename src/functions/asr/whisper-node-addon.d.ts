/**
 * @kutalia/whisper-node-addon ambient declaration
 *
 * 套件本身沒 .d.ts，這裡給出 transcribe API 的型別。
 * 完整文件：https://github.com/Kutalia/whisper-node-addon
 */

declare module '@kutalia/whisper-node-addon' {
  export interface TranscribeOptions {
    /** 音訊檔案路徑（與 fname_inp_buffer 互斥） */
    fname_inp?: string;
    /** 直接傳 PCM Float32Array buffer（不寫檔） */
    fname_inp_buffer?: Float32Array;
    /** ggml 模型檔路徑 */
    model: string;
    /** 語言代碼（'zh'、'en'、'auto' 等） */
    language?: string;
    /** 是否使用 GPU（Vulkan/Metal/CUDA） */
    use_gpu?: boolean;
    /** 是否使用 flash attention */
    flash_attn?: boolean;
    /** 是否抑制 whisper.cpp 印的 log */
    no_prints?: boolean;
    /** 翻譯成英文 */
    translate?: boolean;
    /** beam search 大小 */
    beam_size?: number;
  }

  export interface TranscribeSegment {
    /** 開始時間（秒） */
    t0: number;
    /** 結束時間（秒） */
    t1: number;
    /** 文字 */
    text: string;
  }

  export interface TranscribeResult {
    /** 語言偵測結果 */
    detection_result?: {
      language: string;
      confidence: number;
    };
    /** 完整轉錄文字 */
    text: string;
    /** 各時間段 */
    segments: TranscribeSegment[];
    /** 使用的語言 */
    language: string;
  }

  /**
   * 同步 transcribe API
   */
  export function transcribe(options: TranscribeOptions): Promise<TranscribeResult>;

  const whisperAddon: {
    transcribe: typeof transcribe;
  };

  export default whisperAddon;
}
