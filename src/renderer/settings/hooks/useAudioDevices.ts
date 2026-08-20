/**
 * useAudioDevices hook
 *
 * 封裝 enumerateDevices + devicechange 監聽，回傳當前所有 audio input 設備。
 * 給 SettingsApp 與 MicTab 共用。
 */

import { useEffect, useState } from 'react';

export function useAudioDevices(): MediaDeviceInfo[] {
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);

  useEffect(() => {
    let cancelled = false;

    async function refresh() {
      try {
        const all = await navigator.mediaDevices.enumerateDevices();
        if (cancelled) return;
        setDevices(all.filter((d) => d.kind === 'audioinput'));
      } catch (err) {
        console.warn('[useAudioDevices] enumerateDevices failed:', err);
      }
    }

    refresh();
    navigator.mediaDevices.addEventListener('devicechange', refresh);
    return () => {
      cancelled = true;
      navigator.mediaDevices.removeEventListener('devicechange', refresh);
    };
  }, []);

  return devices;
}
