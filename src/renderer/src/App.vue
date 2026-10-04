<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import type { AppSnapshot, ChannelHealthMap } from '../../shared/types'
import { APP_VERSION } from '../../shared/version'
import MainView from './components/MainView.vue'
import HistoryView from './components/HistoryView.vue'
import IpProbeView from './components/IpProbeView.vue'

const snapshot = ref<AppSnapshot | null>(null)
const channelHealth = ref<ChannelHealthMap>({})
const tab = ref<'live' | 'history' | 'ip'>('live')
const ipProbeActivation = ref(0)
type NoticeLevel = 'error' | 'warning'
const notice = ref<{ message: string; level: NoticeLevel } | null>(null)
const dismissedSnapshotError = ref<string | null>(null)
let unsubscribe: (() => void) | null = null
let unsubscribeChannelHealth: (() => void) | null = null

watch(
  () => snapshot.value?.error,
  (message) => {
    if (!message) {
      dismissedSnapshotError.value = null
      return
    }
    if (message !== dismissedSnapshotError.value) showError(message)
  }
)

onMounted(async () => {
  unsubscribe = window.networkTest.onSnapshot((value) => {
    snapshot.value = value
  })
  unsubscribeChannelHealth = window.networkTest.onChannelHealth((value) => {
    channelHealth.value = value
  })
  try {
    const [initialSnapshot, initialHealth] = await Promise.all([
      window.networkTest.snapshot(),
      window.networkTest.channelHealth()
    ])
    snapshot.value = initialSnapshot
    channelHealth.value = initialHealth
  } catch (cause) {
    showError(cause instanceof Error ? cause.message : String(cause))
  }
})
onBeforeUnmount(() => {
  unsubscribe?.()
  unsubscribeChannelHealth?.()
})

function minimizeWindow(): void {
  void window.networkTest.minimizeMain()
}
function closeWindow(): void {
  void window.networkTest.closeMain()
}
function openIpProbe(): void {
  ipProbeActivation.value++
  tab.value = 'ip'
}
function showError(message: string): void {
  dismissedSnapshotError.value = null
  notice.value = { message, level: 'error' }
}
function showWarning(message: string): void {
  notice.value = { message, level: 'warning' }
}
function dismissNotice(): void {
  if (notice.value?.level === 'error') dismissedSnapshotError.value = notice.value.message
  notice.value = null
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
          <button class="nav-item" :class="{ selected: tab === 'ip' }" @click="openIpProbe">
            <span aria-hidden="true">⌖</span>IP 探测
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
        <div v-if="!snapshot" class="loading">正在连接测速引擎…</div>
        <template v-else>
          <MainView
            v-if="tab === 'live'"
            :snapshot="snapshot"
            :channel-health="channelHealth"
            @error="showError"
            @warning="showWarning"
          />
          <HistoryView v-else-if="tab === 'history'" :snapshot="snapshot" />
          <IpProbeView v-else :key="ipProbeActivation" />
        </template>
        <button
          v-if="notice"
          class="toast"
          :class="`toast--${notice.level}`"
          :aria-label="`${notice.level === 'error' ? '错误' : '警告'}提示，点击关闭`"
          :role="notice.level === 'error' ? 'alert' : 'status'"
          type="button"
          @click="dismissNotice"
        >
          {{ notice.message }}
        </button>
      </main>
    </div>
  </div>
</template>
