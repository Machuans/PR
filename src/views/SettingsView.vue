<script setup lang="ts">
import { onMounted } from 'vue';

import { useSettingsStore } from '../stores/settings';

const settingsStore = useSettingsStore();

onMounted(() => {
  if (!settingsStore.loaded) {
    settingsStore.load();
  }
});
</script>

<template>
  <section aria-label="全局设置" />
</template>
