// scripts/check-whisper.mjs
// 驗證 @kutalia/whisper-node-addon 在 Windows 上能載入 native binary
// 用法：node scripts/check-whisper.mjs

import whisperAddon from '@kutalia/whisper-node-addon';

console.log('@kutalia/whisper-node-addon loaded successfully');
console.log('Exports keys:', Object.keys(whisperAddon).slice(0, 20));
console.log('Default export type:', typeof whisperAddon);

// 看 transcribe API 簽名
if (typeof whisperAddon.transcribe === 'function') {
  console.log('transcribe function: available');
  console.log('  toString:', whisperAddon.transcribe.toString().slice(0, 200));
}
if (typeof whisperAddon.transcribeWithBuffers === 'function') {
  console.log('transcribeWithBuffers function: available');
}
if (typeof whisperAddon.detectLanguage === 'function') {
  console.log('detectLanguage function: available');
}

// 列出所有 function
for (const [k, v] of Object.entries(whisperAddon)) {
  if (typeof v === 'function') {
    console.log(`  fn: ${k}`);
  }
}
