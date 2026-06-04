import { defineStore } from 'pinia';

import {
  loadLocalSettings,
  saveLocalSettings,
  type LocalSettings,
} from '../api/tauri-ipc';

export const useSettingsStore = defineStore('settings', {
  state: () => ({
    settings: {} as LocalSettings,
    loading: false,
    loaded: false,
    error: '',
  }),

  actions: {
    async load() {
      this.loading = true;
      this.error = '';

      try {
        this.settings = await loadLocalSettings();
        this.loaded = true;
      } catch (error) {
        this.error = error instanceof Error ? error.message : String(error);
      } finally {
        this.loading = false;
      }
    },

    async save(patch: Partial<LocalSettings> = {}) {
      this.settings = {
        ...this.settings,
        ...patch,
      };

      await saveLocalSettings(this.settings);
    },
  },
});
