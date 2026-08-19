// scripts/check-asr.mjs
// 驗證 sherpa-onnx-node 在 Windows 上能載入 native binary
// 用法：node scripts/check-asr.mjs

import sherpa_onnx from 'sherpa-onnx-node';

console.log('sherpa-onnx-node loaded successfully');
console.log('Exports keys:', Object.keys(sherpa_onnx).slice(0, 20));

// 列出關鍵的 recognizer 類別
const hasOnline = typeof sherpa_onnx.OnlineRecognizer === 'function';
const hasOffline = typeof sherpa_onnx.OfflineRecognizer === 'function';

console.log('OnlineRecognizer class available:', hasOnline);
console.log('OfflineRecognizer class available:', hasOffline);

if (!hasOnline) {
  console.error('FAIL: OnlineRecognizer not found. Check sherpa-onnx-node version.');
  process.exit(1);
}

if (!hasOffline) {
  console.error('FAIL: OfflineRecognizer not found. Check sherpa-onnx-node version.');
  process.exit(1);
}

console.log('OK: sherpa-onnx-node is ready for P1 stage 2 (ASR integration)');
