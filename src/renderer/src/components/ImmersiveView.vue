<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import type { AppSnapshot, TrafficDirection } from '../../../shared/types'
import { bytes, duration, mbps, speed, speedForDisplay, threadLabel } from '../format'
import SpeedChart from './SpeedChart.vue'

const props = defineProps<{ snapshot: AppSnapshot }>()
const emit = defineEmits<{ exit: [] }>()
const now = ref(Date.now())
let clockTimer: ReturnType<typeof setInterval> | undefined
let durationSnapshotAt = now.value

onMounted(() => {
  clockTimer = setInterval(() => (now.value = Date.now()), 1000)
})
onBeforeUnmount(() => {
  if (clockTimer) clearInterval(clockTimer)
})
watch(
  () => [props.snapshot.record?.id, props.snapshot.record?.activeDurationMs, props.snapshot.running],
  () => (durationSnapshotAt = Date.now()),
  { immediate: true }
)

const record = computed(() => props.snapshot.record)
const mode = computed(() => record.value?.mode ?? props.snapshot.settings.mode)
const modeLabel = computed(() =>
  mode.value === 'parallel' ? '并行测速' : mode.value === 'upload' ? '上行测速' : '下行测速'
)
const tested = (direction: TrafficDirection): boolean =>
  Boolean(record.value) && (mode.value === 'parallel' || mode.value === direction)
const activeDurationMs = computed(() =>
  Math.max(
    0,
    (record.value?.activeDurationMs ?? 0) +
      (props.snapshot.running ? now.value - durationSnapshotAt : 0)
  )
)
const currentTime = computed(() => new Date(now.value).toLocaleTimeString('zh-CN', { hour12: false }))
const currentDate = computed(() => new Date(now.value).toLocaleDateString('zh-CN'))
const currentChannel = computed(() => {
  const channelId = record.value?.segments.at(-1)?.channelId ?? props.snapshot.settings.channelId
  return props.snapshot.channels.find((channel) => channel.id === channelId)?.label ?? channelId
})
const currentThreads = computed(() =>
  threadLabel(record.value?.segments.at(-1)?.threadCount ?? props.snapshot.settings.threadCount)
)
const statusLabel = computed(() =>
  props.snapshot.running ? '测速中' : props.snapshot.paused ? '已暂停' : '已结束'
)

function directionBytes(direction: TrafficDirection): number {
  return direction === 'download' ? (record.value?.downloadBytes ?? 0) : (record.value?.uploadBytes ?? 0)
}
function directionSpeed(direction: TrafficDirection): number | null {
  if (!tested(direction) || !record.value) return null
  const samples = direction === 'download' ? record.value.samples : record.value.uploadSamples
  const average =
    direction === 'download'
      ? record.value.downloadAverageBytesPerSec
      : record.value.uploadAverageBytesPerSec
  return speedForDisplay(
    samples.at(-1)?.bytesPerSec ?? 0,
    average,
    props.snapshot.running,
    props.snapshot.paused
  )
}
const downloadSpeed = computed(() => directionSpeed('download'))
const uploadSpeed = computed(() => directionSpeed('upload'))
const totalSpeed = computed(() =>
  record.value
    ? (downloadSpeed.value ?? 0) + (uploadSpeed.value ?? 0)
    : null
)
const curveWindowEnd = computed(() =>
  props.snapshot.running ? now.value : record.value?.endedAt
)
const taskType = computed(() =>
  props.snapshot.settings.maxBytes > 0
    ? 'traffic'
    : props.snapshot.settings.maxDurationSec > 0
      ? 'time'
      : 'unlimited'
)
const trafficProgress = computed(() => {
  const maximum = props.snapshot.settings.maxBytes
  if (maximum <= 0 || !record.value) return []
  const directions: TrafficDirection[] =
    mode.value === 'parallel' ? ['download', 'upload'] : [mode.value]
  return directions.map((direction) => {
    const used = directionBytes(direction)
    return {
      direction,
      label: direction === 'download' ? '下行' : '上行',
      used,
      remaining: Math.max(0, maximum - used),
      value: Math.min(maximum, used),
      maximum,
      percent: Math.min(100, (used / maximum) * 100)
    }
  })
})
const durationLimitMs = computed(() => props.snapshot.settings.maxDurationSec * 1000)
const durationProgress = computed(() =>
  durationLimitMs.value > 0
    ? Math.min(100, (activeDurationMs.value / durationLimitMs.value) * 100)
    : 0
)
const downloadPeak = computed(() => record.value?.downloadPeakBytesPerSec ?? 0)
const uploadPeak = computed(() => record.value?.uploadPeakBytesPerSec ?? 0)
</script>

<template>
  <main id="immersive-view" class="immersive-view" aria-label="沉浸模式测速仪表盘">
    <header class="top-row">
      <div class="clock-block">
        <time class="clock" :datetime="new Date(now).toISOString()">{{ currentTime }}</time>
        <span class="date">{{ currentDate }}</span>
      </div>
      <div class="run-block" aria-label="本次测速有效运行时间">
        <span class="eyebrow">本次运行</span>
        <strong>{{ duration(activeDurationMs) }}</strong>
      </div>
      <button class="exit-button" type="button" aria-label="退出沉浸模式" @click="emit('exit')">
        退出沉浸模式
      </button>
    </header>

    <section class="task-panel" aria-labelledby="task-title">
      <div class="task-heading">
        <h1 id="task-title">当前任务</h1>
        <span
          id="immersive-status"
          class="status"
          :class="{ active: snapshot.running, paused: snapshot.paused }"
          role="status"
        >
          {{ statusLabel }}
        </span>
      </div>
      <dl class="task-details">
        <div><dt>模式</dt><dd>{{ modeLabel }}</dd></div>
        <div><dt>当前节点</dt><dd>{{ currentChannel }}</dd></div>
        <div><dt>线程数</dt><dd>{{ currentThreads }}</dd></div>
      </dl>

      <div class="limit-block" aria-label="任务限额和进度">
        <template v-if="taskType === 'traffic'">
          <div v-for="item in trafficProgress" :key="item.direction" class="limit-item">
            <div class="limit-title">
              <strong>{{ item.label }}限量</strong>
              <span>{{ item.percent.toFixed(0) }}%</span>
            </div>
            <progress
              :value="item.value"
              :max="item.maximum"
              :aria-label="`${item.label}流量限额进度`"
            />
            <div class="limit-values">
              <span>已用 {{ bytes(item.used) }} / {{ bytes(item.maximum) }}</span>
              <span>剩余 {{ bytes(item.remaining) }}</span>
            </div>
          </div>
          <p v-if="!trafficProgress.length" class="unlimited-note">限量任务等待测速数据</p>
        </template>
        <div v-else-if="taskType === 'time'" class="limit-item">
          <div class="limit-title">
            <strong>限时任务</strong>
            <span>{{ durationProgress.toFixed(0) }}%</span>
          </div>
          <progress
            :value="Math.min(activeDurationMs, durationLimitMs)"
            :max="durationLimitMs"
            aria-label="限时任务进度"
          />
          <div class="limit-values">
            <span>已运行 {{ duration(activeDurationMs) }} / {{ duration(durationLimitMs) }}</span>
            <span>剩余 {{ duration(Math.max(0, durationLimitMs - activeDurationMs)) }}</span>
          </div>
        </div>
        <div v-else class="unlimited-note">无限制</div>
      </div>
    </section>

    <section class="direction-grid" aria-label="上下行测速数据">
      <article class="direction-card" :class="{ untested: !tested('download') }">
        <div class="direction-heading">
          <h2>下行</h2>
          <span v-if="!tested('download')" class="untested-label">未测试</span>
        </div>
        <div class="speed-reading">
          <strong>{{ downloadSpeed === null ? '未测试' : speed(downloadSpeed) }}</strong>
          <span>下行速度</span>
        </div>
        <div class="chart-area">
          <SpeedChart
            title="下行速度"
            :tested="tested('download')"
            :samples="record?.samples ?? []"
            :segments="record?.segments ?? []"
            :channels="snapshot.channels"
            :started-at="record?.startedAt"
            :window-end="curveWindowEnd"
          />
        </div>
        <dl class="metrics">
          <div><dt>下行带宽</dt><dd>{{ downloadSpeed === null ? '未测试' : mbps(downloadSpeed) }}</dd></div>
          <div><dt>下行流量</dt><dd>{{ tested('download') ? bytes(record?.downloadBytes ?? 0) : '未测试' }}</dd></div>
          <div><dt>下行峰值</dt><dd>{{ tested('download') ? speed(downloadPeak) : '未测试' }}</dd></div>
        </dl>
      </article>

      <article class="direction-card" :class="{ untested: !tested('upload') }">
        <div class="direction-heading">
          <h2>上行</h2>
          <span v-if="!tested('upload')" class="untested-label">未测试</span>
        </div>
        <div class="speed-reading">
          <strong>{{ uploadSpeed === null ? '未测试' : speed(uploadSpeed) }}</strong>
          <span>上行速度</span>
        </div>
        <div class="chart-area">
          <SpeedChart
            title="上行速度"
            :tested="tested('upload')"
            :samples="record?.uploadSamples ?? []"
            :segments="record?.segments ?? []"
            :channels="snapshot.channels"
            :started-at="record?.startedAt"
            :window-end="curveWindowEnd"
          />
        </div>
        <dl class="metrics">
          <div><dt>上行带宽</dt><dd>{{ uploadSpeed === null ? '未测试' : mbps(uploadSpeed) }}</dd></div>
          <div><dt>上行流量</dt><dd>{{ tested('upload') ? bytes(record?.uploadBytes ?? 0) : '未测试' }}</dd></div>
          <div><dt>上行峰值</dt><dd>{{ tested('upload') ? speed(uploadPeak) : '未测试' }}</dd></div>
        </dl>
      </article>
    </section>

    <section class="aggregate" aria-label="合计测速数据">
      <div><span>合计速度</span><strong>{{ totalSpeed === null ? '—' : speed(totalSpeed) }}</strong></div>
      <div><span>合计带宽</span><strong>{{ totalSpeed === null ? '—' : mbps(totalSpeed) }}</strong></div>
      <div><span>合计流量</span><strong>{{ record ? bytes(record.totalBytes) : '—' }}</strong></div>
    </section>
  </main>
</template>

<style scoped>
.immersive-view {
  width: 100%;
  height: 100%;
  min-height: 100vh;
  overflow: auto;
  display: grid;
  grid-template-rows: auto auto minmax(300px, 1fr) auto;
  gap: clamp(12px, 2vh, 22px);
  padding: clamp(18px, 3.2vw, 48px);
  color: var(--text-primary);
  background: radial-gradient(ellipse at top, #292c30 0%, var(--app-bg) 70%);
}
.top-row,
.task-heading,
.direction-heading,
.limit-title,
.limit-values {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
}
.clock-block,
.run-block {
  display: grid;
  gap: 3px;
}
.clock {
  font-size: clamp(34px, 5vw, 64px);
  line-height: 1;
  font-variant-numeric: tabular-nums;
  letter-spacing: -0.04em;
}
.date,
.eyebrow,
.speed-reading > span,
.metrics dt,
.aggregate span,
.task-details dt {
  color: var(--text-tertiary);
}
.date,
.eyebrow {
  font-size: 13px;
}
.run-block {
  margin-right: auto;
  margin-left: clamp(20px, 5vw, 72px);
}
.run-block strong {
  font-size: clamp(21px, 2.5vw, 32px);
  font-variant-numeric: tabular-nums;
}
.exit-button {
  min-height: 42px;
  padding: 0 18px;
  border: 1px solid var(--line-strong);
  border-radius: 10px;
  color: var(--text-primary);
  background: var(--panel);
}
.exit-button:hover,
.exit-button:focus-visible {
  border-color: var(--accent);
  outline: none;
}
.task-panel,
.direction-card,
.aggregate {
  border: 1px solid var(--line);
  border-radius: 16px;
  background: rgb(29 31 34 / 88%);
}
.task-panel {
  padding: clamp(16px, 2vw, 24px);
}
.task-heading h1,
.direction-heading h2 {
  margin: 0;
}
.task-heading h1 {
  font-size: 17px;
}
.status,
.untested-label {
  padding: 5px 10px;
  border: 1px solid var(--line-strong);
  border-radius: 999px;
  color: var(--text-secondary);
  font-size: 12px;
}
.status.active {
  color: var(--text-primary);
  border-color: #737a80;
}
.status.paused {
  border-style: dashed;
}
.task-details {
  display: flex;
  flex-wrap: wrap;
  gap: 12px clamp(24px, 4vw, 58px);
  margin: 18px 0;
}
.task-details div,
.metrics div {
  min-width: 0;
}
.task-details dt,
.metrics dt {
  margin-bottom: 5px;
  font-size: 12px;
}
.task-details dd,
.metrics dd {
  margin: 0;
  font-weight: 600;
}
.limit-block {
  display: grid;
  gap: 12px;
  padding-top: 16px;
  border-top: 1px solid var(--line);
}
.limit-item {
  display: grid;
  gap: 7px;
}
.limit-title,
.limit-values {
  font-size: 12px;
}
.limit-title span,
.limit-values span:last-child {
  color: var(--text-secondary);
}
.limit-values {
  flex-wrap: wrap;
  color: var(--text-tertiary);
}
progress {
  width: 100%;
  height: 6px;
  overflow: hidden;
  border: 0;
  border-radius: 999px;
  background: var(--panel-raised);
  accent-color: var(--accent);
}
progress::-webkit-progress-bar {
  border-radius: 999px;
  background: var(--panel-raised);
}
progress::-webkit-progress-value {
  border-radius: 999px;
  background: var(--accent);
}
.unlimited-note {
  margin: 0;
  color: var(--text-secondary);
  font-size: 13px;
}
.direction-grid {
  min-height: 0;
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: clamp(12px, 2vw, 24px);
}
.direction-card {
  min-height: 0;
  display: grid;
  grid-template-rows: auto auto minmax(100px, 1fr) auto;
  gap: 12px;
  padding: clamp(14px, 2vw, 24px);
}
.direction-card.untested {
  background: rgb(29 31 34 / 64%);
}
.direction-heading h2 {
  font-size: 16px;
}
.speed-reading {
  display: flex;
  align-items: baseline;
  gap: 12px;
}
.speed-reading strong {
  font-size: clamp(26px, 3.5vw, 44px);
  line-height: 1.1;
  font-variant-numeric: tabular-nums;
}
.speed-reading > span {
  font-size: 12px;
}
.chart-area {
  min-height: 100px;
}
.metrics {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 12px;
  margin: 0;
  padding-top: 12px;
  border-top: 1px solid var(--line);
}
.metrics dd {
  overflow-wrap: anywhere;
  font-size: clamp(12px, 1.2vw, 15px);
  font-variant-numeric: tabular-nums;
}
.aggregate {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 16px;
  padding: 18px clamp(16px, 2vw, 24px);
}
.aggregate div {
  display: grid;
  gap: 6px;
}
.aggregate div + div {
  padding-left: 18px;
  border-left: 1px solid var(--line);
}
.aggregate span {
  font-size: 12px;
}
.aggregate strong {
  font-size: clamp(16px, 2vw, 25px);
  font-variant-numeric: tabular-nums;
}
@media (max-width: 760px) {
  .immersive-view {
    grid-template-rows: auto auto auto auto;
  }
  .direction-grid {
    grid-template-columns: 1fr;
  }
  .direction-card {
    min-height: 290px;
  }
}
@media (max-width: 460px) {
  .top-row {
    flex-wrap: wrap;
  }
  .run-block {
    margin-left: auto;
  }
  .exit-button {
    flex: 1 0 100%;
  }
  .aggregate {
    grid-template-columns: 1fr;
  }
  .aggregate div + div {
    padding: 12px 0 0;
    border-top: 1px solid var(--line);
    border-left: 0;
  }
}
</style>
