import { createRouter, createWebHistory, type RouteRecordRaw } from 'vue-router';

import ChatView from '../views/ChatView.vue';
import CharactersView from '../views/CharactersView.vue';
import MemoryView from '../views/MemoryView.vue';
import SettingsView from '../views/SettingsView.vue';

const routes: RouteRecordRaw[] = [
  {
    path: '/',
    redirect: '/chat',
  },
  {
    path: '/chat',
    name: 'chat',
    component: ChatView,
    meta: {
      title: '未命名聊天',
    },
  },
  {
    path: '/characters',
    name: 'characters',
    component: CharactersView,
    meta: {
      title: '角色广场',
    },
  },
  {
    path: '/memory',
    name: 'memory',
    component: MemoryView,
    meta: {
      title: '记忆摘要',
    },
  },
  {
    path: '/settings',
    name: 'settings',
    component: SettingsView,
    meta: {
      title: '全局设置',
    },
  },
  {
    path: '/:pathMatch(.*)*',
    redirect: '/chat',
  },
];

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes,
});

export default router;
