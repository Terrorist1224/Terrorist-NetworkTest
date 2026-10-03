<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'
import type { AppSnapshot } from '../../shared/types'
import { APP_VERSION } from '../../shared/version'
import MainView from './components/MainView.vue'
import HistoryView from './components/HistoryView.vue'

const snapshot = ref<AppSnapshot | null>(null)
const tab = ref<'live' | 'history'>('live')
const error = ref<string | null>(null)
let unsubscribe: (() => void) | null = null

onMounted(async () => {
  unsubscribe = window.networkTest.onSnapshot((value) => {
    snapshot.value = value
  })
  try {
    snapshot.value = await window.networkTest.snapshot()
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : String(cause)
  }
})
onBeforeUnmount(() => unsubscribe?.())

function minimizeWindow(): void {
  void window.networkTest.minimizeMain()
}
function closeWindow(): void {
  void window.networkTest.closeMain()
}
</script>

<template>
  <div class="desktop-backdrop">
    <div class="app-shell">
      <header class="window-bar">
        <div class="brand" :aria-label="`NetworkTest ${APP_VERSION}`">
          <div class="brand-icon">N</div>
          <span>NetworkTest {{ APP_VERSION }}</span>
        </div>
        <nav class="top-nav" aria-label="主导航">
          <button class="nav-item" :class="{ selected: tab === 'live' }" @click="tab = 'live'">
            <span aria-hidden="true">◉</span>测速
          </button>
          <button
            class="nav-item"
            :class="{ selected: tab === 'history' }"
            @click="tab = 'history'"
          >
            <span aria-hidden="true">⌁</span>历史记录
          </button>
        </nav>
        <div class="window-controls">
          <button class="window-control" aria-label="最小化" title="最小化" @click="minimizeWindow">
            <span aria-hidden="true">−</span>
          </button>
          <button
            class="window-control close-control"
            aria-label="关闭窗口并驻留托盘"
            title="关闭窗口并驻留托盘"
            @click="closeWindow"
          >
            <span aria-hidden="true">×</span>
          </button>
        </div>
      </header>
      <main class="content">
        <div v-if="!snapshot" class="loading">
          正在连接测速引擎… <span v-if="error">{{ error }}</span>
        </div>
        <template v-else>
          <MainView v-if="tab === 'live'" :snapshot="snapshot" @error="error = $event" />
          <HistoryView v-else :snapshot="snapshot" />
          <div v-if="error" class="toast" role="alert">
            {{ error }}<button @click="error = null">关闭</button>
          </div>
        </template>
      </main>
    </div>
  </div>
</template>
