import { invoke } from '@tauri-apps/api/core';

export interface LocalSettings {
  theme?: string;
  fontSize?: number;
  pageWidth?: string;
  avatarStyle?: string;
  chatStyle?: string;
  bubbleWidth?: number;
  messageSpacing?: number;
  showAvatar?: boolean;
  backgroundImage?: string;
  backgroundBlur?: number;
  backgroundOpacity?: number;
  customCss?: string;
  [key: string]: unknown;
}

export async function loadLocalSettings(): Promise<LocalSettings> {
  return invoke<LocalSettings>('load_local_settings');
}

export async function saveLocalSettings(settings: LocalSettings): Promise<void> {
  await invoke('save_local_settings', { settings });
}
