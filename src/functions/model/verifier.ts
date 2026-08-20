/**
 * 模型檔案完整性校驗（TOFU 自我校驗核心）
 *
 * 設計：
 * - 對「整個模型目錄」算整體 SHA-256（支援 sherpa-onnx 多檔 + Luigi 4 檔 + whisper 單檔）
 * - 整體 hash 演算法：對目錄內每個檔案（依檔名排序）算 SHA-256，再 concat 起來算一次
 * - 不需預先把整個檔案讀進記憶體（用 stream）
 *
 * 結果有 5 種狀態（`VerificationStatus`）：
 * - `official-verified`：preset 內建官方 baseline + 對得起來
 * - `tofu-verified`：自建 TOFU baseline + 對得起來
 * - `mismatch`：有 baseline 但對不起來（檔案被竊改 / 損壞）
 * - `no-baseline`：沒任何 baseline（首次下載中 / 還沒建立 TOFU）
 * - `not-installed`：路徑不存在 / 不可讀
 */

import { createReadStream, createWriteStream } from 'node:fs';
import { stat, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join, basename } from 'node:path';
import type { TofuBaseline } from '../../shared/types';

/** 校驗結果狀態 */
export type VerificationStatus =
  | 'official-verified' // 官方 baseline 對得起來
  | 'tofu-verified' // TOFU baseline 對得起來
  | 'mismatch' // baseline 對不起來
  | 'no-baseline' // 都沒 baseline（首次下載中）
  | 'not-installed'; // 路徑不存在 / 不可讀

/** 單檔 hash 資訊（debug / 細節用） */
export interface PerFileHash {
  name: string;
  size: number;
  sha256: string;
}

/** 校驗結果 */
export interface VerificationResult {
  status: VerificationStatus;
  /** 校驗的檔案 / 目錄路徑 */
  filePath: string;
  /** 總大小（目錄則為所有檔案總和） */
  fileSize: number;
  /** 整體 hash（hex lowercase）。not-installed 時為 null */
  actualHash: string | null;
  /** 官方 baseline（hex lowercase）或 null */
  officialSha256: string | null;
  /** TOFU baseline 或 null */
  tofuBaseline: TofuBaseline | null;
  /** 細節：每個檔案的 hash（debug 用） */
  perFileHashes: PerFileHash[];
}

/** 校驗選項 */
export interface VerifyOptions {
  /** 官方 SHA-256 baseline（preset 內建），沒有就 null */
  officialSha256: string | null;
  /** TOFU self-baseline（settings 存），沒有就 null */
  tofuBaseline: TofuBaseline | null;
}

/**
 * 對單一檔案算 SHA-256（stream，大檔不爆記憶體）
 */
export async function hashFile(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256');
    const stream = createReadStream(filePath);
    stream.on('data', (chunk: Buffer | string) => hash.update(chunk));
    stream.on('end', () => resolve(hash.digest('hex')));
    stream.on('error', reject);
  });
}

/**
 * 對模型路徑（檔案 or 目錄）算整體 hash
 *
 * 演算法：
 * - 若是檔案：直接 sha256
 * - 若是目錄：依檔名排序每個檔案 → 各算 sha256 → concat 成單一字串 → 再算一次 sha256
 *
 * 用檔名排序保證 deterministic（同樣檔案內容、無論 OS / 檔案系統順序都同樣結果）
 *
 * @returns 整體 hash、總大小、每檔 hash 細節
 */
export async function hashModelPath(modelPath: string): Promise<{
  hash: string;
  size: number;
  perFile: PerFileHash[];
}> {
  const s = await stat(modelPath);
  if (s.isFile()) {
    const hash = await hashFile(modelPath);
    return {
      hash,
      size: s.size,
      perFile: [{ name: basename(modelPath), size: s.size, sha256: hash }],
    };
  }
  if (!s.isDirectory()) {
    throw new Error(`不支援的路徑型別：${modelPath}`);
  }

  const entries = await readdir(modelPath, { withFileTypes: true });
  const fileNames = entries.filter((e) => e.isFile()).map((e) => e.name);
  fileNames.sort(); // 確保 deterministic

  let totalSize = 0;
  const perFile: PerFileHash[] = [];
  const concatHashes: string[] = [];

  for (const name of fileNames) {
    const fp = join(modelPath, name);
    const fs = await stat(fp);
    if (!fs.isFile()) continue;
    const sha = await hashFile(fp);
    perFile.push({ name, size: fs.size, sha256: sha });
    totalSize += fs.size;
    concatHashes.push(sha);
  }

  // 整體 hash = sha256( "sha1\nsha2\nsha3..." ) — 用 '\n' 分隔
  const overall = createHash('sha256');
  for (const sha of concatHashes) {
    overall.update(sha);
    overall.update('\n');
  }
  return { hash: overall.digest('hex'), size: totalSize, perFile };
}

/**
 * 對已下載的模型做完整性校驗
 *
 * 比對優先序：
 * 1. 官方 baseline（preset.sha256）— 最強信任
 * 2. TOFU baseline（settings.tofuBaselines[preset]）— 自建信任
 * 3. 都沒有 → no-baseline（首次下載中）
 */
export async function verifyModel(
  modelPath: string,
  options: VerifyOptions,
): Promise<VerificationResult> {
  const base: Omit<VerificationResult, 'status'> = {
    filePath: modelPath,
    fileSize: 0,
    actualHash: null,
    officialSha256: options.officialSha256,
    tofuBaseline: options.tofuBaseline,
    perFileHashes: [],
  };

  // 嘗試算 hash（檔案 / 目錄不存在會丟錯 → 走 not-installed）
  let actualHash: string;
  let perFileHashes: PerFileHash[];
  let fileSize: number;
  try {
    const result = await hashModelPath(modelPath);
    actualHash = result.hash;
    perFileHashes = result.perFile;
    fileSize = result.size;
  } catch (_err) {
    return { ...base, status: 'not-installed' };
  }

  // 官方 baseline 優先
  if (options.officialSha256) {
    if (actualHash === options.officialSha256) {
      return {
        ...base,
        status: 'official-verified',
        actualHash,
        fileSize,
        perFileHashes,
      };
    }
    return {
      ...base,
      status: 'mismatch',
      actualHash,
      fileSize,
      perFileHashes,
    };
  }

  // TOFU baseline
  if (options.tofuBaseline) {
    if (actualHash === options.tofuBaseline.sha256) {
      return {
        ...base,
        status: 'tofu-verified',
        actualHash,
        fileSize,
        perFileHashes,
      };
    }
    return {
      ...base,
      status: 'mismatch',
      actualHash,
      fileSize,
      perFileHashes,
    };
  }

  // 都沒有
  return {
    ...base,
    status: 'no-baseline',
    actualHash,
    fileSize,
    perFileHashes,
  };
}

/**
 * 從目錄路徑建立 TOFU baseline（首次下載完成時呼叫）
 *
 * @param modelPath 模型目錄路徑
 * @param source 建立來源（auto = 自動 / manual = user 手動）
 * @returns TOFU baseline（含 hash + size + timestamp）
 */
export async function establishTofu(
  modelPath: string,
  source: 'auto' | 'manual' = 'auto',
): Promise<TofuBaseline> {
  const { hash, size } = await hashModelPath(modelPath);
  return {
    sha256: hash,
    sizeBytes: size,
    establishedAt: new Date().toISOString(),
    source,
  };
}

// ===== 進度條輔助函式（給 download-model.mjs 內部重用） =====
//
// 為了不讓 download-model.mjs 也重寫 stream SHA-256，這裡暴露兩個小工具。
// 這是內部 helper，不在 app 端呼叫。

/**
 * 建立一個寫入磁碟 + 同時累積 SHA-256 的雙工 stream
 *
 * 用法：
 * ```ts
 * const { stream, finalize } = createHashingFileStream(targetPath);
 * response.body.pipe(stream);
 * await pipeline(response.body, stream);
 * const sha256 = finalize(); // 取得 hex
 * ```
 *
 * @returns stream (可寫入)、finalize (關閉後取得 hex)
 */
export function createHashingFileStream(
  targetPath: string,
): { stream: NodeJS.WritableStream; finalize: () => Promise<string> } {
  // 確保目錄存在
  const hash = createHash('sha256');
  const fileStream = createWriteStream(targetPath);

  const stream = {
    write: (
      chunk: Buffer | string,
      encoding?: BufferEncoding,
      cb?: (err?: Error | null) => void,
    ) => {
      hash.update(chunk);
      return fileStream.write(chunk, encoding ?? ('utf8' as BufferEncoding), cb);
    },
    end: (cb?: () => void) => fileStream.end(cb),
    on: fileStream.on.bind(fileStream),
    once: fileStream.once.bind(fileStream),
    emit: fileStream.emit.bind(fileStream),
  } as unknown as NodeJS.WritableStream;

  const finalize = async (): Promise<string> => {
    // 等待 fileStream close
    if (!fileStream.destroyed && fileStream.writable) {
      await new Promise<void>((resolve) => fileStream.once('close', () => resolve()));
    }
    return hash.digest('hex');
  };

  return { stream, finalize };
}
