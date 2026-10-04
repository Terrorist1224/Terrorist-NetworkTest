<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type {
  AppSnapshot,
  ChannelHealthMap,
  ChannelHealthStatus,
  ChannelSelectionMode,
  StopMode,
  TestMode
} from '../../../shared/types'
import {
  automaticChannelLabel,
  bestDomesticChannel,
  isEligibleChannel
} from '../../../shared/channel-selection'
import { bytes, duration, mbps, speed, speedForDisplay, threadLabel } from '../format'
import SelectDropdown from './SelectDropdown.vue'
import SpeedChart from './SpeedChart.vue'

const props = defineProps<{ snapshot: AppSnapshot; channelHealth: ChannelHealthMap }>()
const emit = defineEmits<{ error: [message: string]; warning: [message: string] }>()
const mode = ref<TestMode>('download')
const channelId = ref('mcloud')
const channelSelection = ref<ChannelSelectionMode>('auto')
const lastDownloadChannelId = ref('mcloud')
const lastSnapshotMode = ref<TestMode>('download')
const threadCount = ref(8)
const stopMode = ref<StopMode>('unlimited')
const durationMinutes = ref<number | string>('')
const limitGb = ref<number | string>('')
const addOpen = ref(false)
const newLabel = ref('')
const newUrl = ref('')
const busy = ref(false)
const modeOptions = [
  { value: 'download', label: '下行' },
  { value: 'upload', label: '上行' },
  { value: 'parallel', label: '并行' }
]
function channelOption(channel: AppSnapshot['channels'][number], group: string) {
  const health = props.channelHealth[channel.id]
  const isSpeedtestCn = channel.provider === 'speedtest-cn'
  const stale =
    isSpeedtestCn &&
    health?.checkedAt !== null &&
    health?.checkedAt !== undefined &&
    Date.now() - health.checkedAt > 75 * 60_000
  const status = stale ? 'checking' : health?.status
  return {
    label: channel.label,
    value: channel.id,
    group,
    healthStatus: status,
    healthTone: isSpeedtestCn && status === 'slow' ? 'yellow' : status,
    healthText: stale ? '检测过期' : channelHealthText(status, health?.latencyMs),
    healthDescription: stale
      ? '超过 75 分钟未更新'
      : channelHealthDescription(status, isSpeedtestCn)
  }
}

const bestAutoChannel = computed(() =>
  bestDomesticChannel(props.snapshot.channels, props.channelHealth, mode.value)
)
const autoChannelOption = computed(() => {
  const best = bestAutoChannel.value
  const active = props.snapshot.running || props.snapshot.paused
  const current = props.snapshot.channels.find(
    (channel) => channel.id === props.snapshot.settings.channelId
  )
  const displayedChannel = active ? current : best
  const health = displayedChannel ? props.channelHealth[displayedChannel.id] : undefined
  const status = health?.status
  return {
    label: automaticChannelLabel(props.snapshot, props.channelHealth),
    value: 'auto',
    group: '自动选择',
    healthStatus: (status ?? 'checking') as ChannelHealthStatus,
    healthText: active
      ? props.snapshot.running
        ? '测速中'
        : '已暂停'
      : health?.latencyMs == null
        ? best
          ? '检测中'
          : '等待节点'
        : `${health.latencyMs} ms`,
    healthDescription: active
      ? `本次实际使用：${current?.label ?? '等待可用节点'}`
      : best
        ? `当前自动选择：${best.label}`
        : '等待符合条件的国内节点'
  }
})
const selectedChannelValue = computed(() =>
  channelSelection.value === 'auto' ? 'auto' : channelId.value
)
const selectedChannelOption = computed(() => {
  if (channelSelection.value === 'auto') return autoChannelOption.value
  const channel = props.snapshot.channels.find((item) => item.id === channelId.value)
  if (!channel) return undefined
  const group = channel.provider ? '测速网国内节点' : channel.custom ? '自定义通道' : '内置国内节点'
  return channelOption(channel, group)
})
const selectedChannelReady = computed(() => {
  if (props.snapshot.paused) return true
  if (channelSelection.value === 'auto') return Boolean(bestAutoChannel.value)
  const channel = props.snapshot.channels.find((item) => item.id === channelId.value)
  return Boolean(channel && isEligibleChannel(channel, props.channelHealth, mode.value))
})

const channelOptions = computed(() => {
  const supportedChannels = props.snapshot.channels.filter((item) =>
    isEligibleChannel(item, props.channelHealth, mode.value)
  )
  const groups = [
    {
      label: '内置国内节点',
      options: supportedChannels.filter((item) => !item.provider && !item.custom)
    },
    {
      label: '测速网国内节点',
      options: supportedChannels.filter((item) => item.provider === 'speedtest-cn')
    },
    {
      label: '自定义通道',
      options: supportedChannels.filter((item) => item.custom)
    }
  ]
  return [
    autoChannelOption.value,
    ...groups
      .filter((group) => group.options.length)
      .flatMap((group) => group.options.map((channel) => channelOption(channel, group.label)))
  ]
})

function channelHealthText(
  status?: ChannelHealthStatus,
  latencyMs?: number | null
): string | undefined {
  if (!status) return undefined
  if (status === 'checking') return '检测中'
  if (status === 'unavailable') return '不可用'
  return `${latencyMs ?? '—'} ms`
}

function channelHealthDescription(
  status?: ChannelHealthStatus,
  speedtestCn = false
): string | undefined {
  if (!status) return undefined
  if (status === 'checking') return '正在检测'
  if (status === 'unavailable')
    return speedtestCn ? '延迟超过 300 毫秒、探测失败或超时' : '探测失败或超时'
  if (speedtestCn) return status === 'fast' ? '延迟不高于 100 毫秒' : '延迟为 101 到 300 毫秒'
  return status === 'fast' ? '延迟低于 300 毫秒' : '延迟达到或超过 300 毫秒'
}
const threadOptions = [0, 4, 8, 16, 32].map((value) => ({
  value,
  label: threadLabel(value)
}))
const stopOptions = [
  { value: 'traffic', label: '限量' },
  { value: 'time', label: '限时' },
  { value: 'unlimited', label: '不限制' }
]

watch(
  () => props.snapshot.settings,
  (settings) => {
    mode.value = settings.mode
    channelSelection.value = settings.channelSelection ?? 'auto'
    if (
      settings.mode === 'download' &&
      lastSnapshotMode.value === 'download' &&
      channelSelection.value === 'manual'
    )
      lastDownloadChannelId.value = settings.channelId
    lastSnapshotMode.value = settings.mode
    channelId.value = settings.channelId
    threadCount.value = settings.threadCount
    if (settings.maxBytes > 0) {
      stopMode.value = 'traffic'
      limitGb.value = Number((settings.maxBytes / 1024 ** 3).toFixed(3))
    } else if (settings.maxDurationSec > 0) {
      stopMode.value = 'time'
      durationMinutes.value = settings.maxDurationSec / 60
    } else {
      stopMode.value = 'unlimited'
    }
  },
  { immediate: true, deep: true }
)

const record = computed(() => props.snapshot.record)
const recordMode = computed(() => record.value?.mode ?? mode.value)
const curveWindowEnd = computed(() => (props.snapshot.running ? Date.now() : record.value?.endedAt))
function testModeForRecord(direction: 'download' | 'upload'): boolean {
  if (!record.value) return false
  return direction === 'download'
    ? record.value.mode !== 'upload'
    : record.value.mode !== 'download'
}
const showChannelActions = computed(() => mode.value === 'download')
const showRemoveChannel = computed(() => {
  const selected = props.snapshot.channels.find((channel) => channel.id === channelId.value)
  return (
    mode.value === 'download' &&
    Boolean(selected?.custom) &&
    !props.snapshot.running &&
    !props.snapshot.paused
  )
})
const showAddChannelFields = computed(() => addOpen.value && showChannelActions.value)
const downloadSpeed = computed(() => record.value?.samples.at(-1)?.bytesPerSec ?? 0)
const uploadSpeed = computed(() => record.value?.uploadSamples.at(-1)?.bytesPerSec ?? 0)
function directionSpeed(direction: 'download' | 'upload'): number {
  const latestSample = direction === 'upload' ? uploadSpeed.value : downloadSpeed.value
  const average =
    direction === 'upload'
      ? (record.value?.uploadAverageBytesPerSec ?? 0)
      : (record.value?.downloadAverageBytesPerSec ?? 0)
  return speedForDisplay(latestSample, average, props.snapshot.running, props.snapshot.paused)
}
const displayDownloadSpeed = computed(() => directionSpeed('download'))
const displayUploadSpeed = computed(() => directionSpeed('upload'))
const totalSpeed = computed(
  () =>
    (testModeForRecord('download') ? displayDownloadSpeed.value : 0) +
    (testModeForRecord('upload') ? displayUploadSpeed.value : 0)
)
function directionMetrics(direction: 'download' | 'upload', title: string) {
  const tested = testModeForRecord(direction)
  const bytesPerSec =
    direction === 'download' ? displayDownloadSpeed.value : displayUploadSpeed.value
  const trafficBytes =
    direction === 'download' ? (record.value?.downloadBytes ?? 0) : (record.value?.uploadBytes ?? 0)
  return [
    { label: `${title}速度`, value: tested ? speed(bytesPerSec) : '—' },
    { label: `${title}带宽`, value: tested ? mbps(bytesPerSec) : '—' },
    { label: `${title}流量`, value: tested ? bytes(trafficBytes) : '—' }
  ]
}
const metricGroups = computed(() => [
  { key: 'download', label: '下行', metrics: directionMetrics('download', '下行') },
  { key: 'upload', label: '上行', metrics: directionMetrics('upload', '上行') },
  {
    key: 'total',
    label: '合计',
    metrics: [
      {
        label: '合计速度',
        value:
          testModeForRecord('download') || testModeForRecord('upload')
            ? speed(totalSpeed.value)
            : '—'
      },
      {
        label: '合计带宽',
        value:
          testModeForRecord('download') || testModeForRecord('upload')
            ? mbps(totalSpeed.value)
            : '—'
      },
      { label: '合计流量', value: record.value ? bytes(record.value.totalBytes) : '—' }
    ]
  }
])
const activeDuration = computed(() => duration(record.value?.activeDurationMs ?? 0))
const progress = computed(() => {
  const { maxBytes, maxDurationSec } = props.snapshot.settings
  if (maxBytes > 0) {
    const measured =
      recordMode.value === 'upload'
        ? (record.value?.uploadBytes ?? 0)
        : recordMode.value === 'parallel'
          ? Math.max(record.value?.downloadBytes ?? 0, record.value?.uploadBytes ?? 0)
          : (record.value?.downloadBytes ?? 0)
    return Math.min(100, (measured / maxBytes) * 100)
  }
  if (maxDurationSec > 0)
    return Math.min(100, ((record.value?.activeDurationMs ?? 0) / (maxDurationSec * 1000)) * 100)
  return 0
})

async function perform(action: () => Promise<unknown>): Promise<void> {
  try {
    busy.value = true
    await action()
  } catch (error) {
    emit('error', error instanceof Error ? error.message : String(error))
  } finally {
    busy.value = false
  }
}

function selectedLimits() {
  if (stopMode.value === 'traffic') {
    const gigabytes = Number(limitGb.value)
    if (!Number.isFinite(gigabytes) || gigabytes <= 0) return null
    return { maxDurationSec: 0, maxBytes: gigabytes * 1024 ** 3 }
  }
  if (stopMode.value === 'time') {
    const minutes = Number(durationMinutes.value)
    if (!Number.isFinite(minutes) || minutes <= 0) return null
    return { maxDurationSec: minutes * 60, maxBytes: 0 }
  }
  return { maxDurationSec: 0, maxBytes: 0 }
}

function settings() {
  const limits = selectedLimits()
  if (!limits)
    throw new Error(
      stopMode.value === 'traffic' ? '请输入有效的 GB 限量值' : '请输入有效的限时分钟数'
    )
  return {
    mode: mode.value,
    channelId:
      channelSelection.value === 'auto'
        ? (bestAutoChannel.value?.id ?? channelId.value)
        : channelId.value,
    channelSelection: channelSelection.value,
    threadCount: Number(threadCount.value),
    ...limits
  }
}

function startOrResume(): void {
  if (props.snapshot.paused) {
    void perform(() => window.networkTest.resume())
    return
  }
  try {
    const testSettings = settings()
    void perform(() => window.networkTest.start(testSettings))
  } catch (cause) {
    emit('warning', cause instanceof Error ? cause.message : String(cause))
  }
}
function pause(): void {
  void perform(() => window.networkTest.pause())
}
function stop(): void {
  void perform(() => window.networkTest.stop())
}

function changeChannel(value: string | number): void {
  void perform(async () => {
    const changed =
      String(value) === 'auto'
        ? await window.networkTest.setChannelSelection('auto')
        : await window.networkTest.changeChannel(String(value))
    channelId.value = changed.settings.channelId
    channelSelection.value = changed.settings.channelSelection ?? 'auto'
  })
}
function selectChannel(value: string | number): void {
  if (String(value) === 'auto') channelSelection.value = 'auto'
  else {
    channelSelection.value = 'manual'
    channelId.value = String(value)
  }
}
function selectMode(value: string | number): void {
  if (value === 'download' || value === 'upload' || value === 'parallel') mode.value = value
}
function changeMode(): void {
  const nextMode = mode.value
  void perform(async () => {
    const changed = await window.networkTest.changeMode(nextMode)
    channelId.value = changed.settings.channelId
    channelSelection.value = changed.settings.channelSelection ?? 'auto'
    if (nextMode === 'download' && channelSelection.value === 'manual') {
      const restore = props.snapshot.channels.find(
        (channel) => channel.id === lastDownloadChannelId.value
      )
      if (
        restore &&
        restore.id !== changed.settings.channelId &&
        isEligibleChannel(restore, props.channelHealth, 'download')
      ) {
        const restored = await window.networkTest.changeChannel(restore.id)
        channelId.value = restored.settings.channelId
      }
    }
  })
}
function changeThreads(): void {
  void perform(() => window.networkTest.changeThreads(Number(threadCount.value)))
}
function selectThreads(value: string | number): void {
  threadCount.value = Number(value)
}
function selectStopMode(value: string | number): void {
  if (value === 'traffic' || value === 'time' || value === 'unlimited') stopMode.value = value
}
function saveLimits(): void {
  if (props.snapshot.running) return
  const limits = selectedLimits()
  if (limits) void perform(() => window.networkTest.saveLimits(limits))
}
function addChannel(): void {
  void perform(async () => {
    const result = await window.networkTest.addChannel(newLabel.value, newUrl.value)
    channelId.value = result.channels.at(-1)?.id ?? channelId.value
    const selected = await window.networkTest.changeChannel(channelId.value)
    channelId.value = selected.settings.channelId
    channelSelection.value = selected.settings.channelSelection ?? 'manual'
    newLabel.value = ''
    newUrl.value = ''
    addOpen.value = false
  })
}
function removeCurrent(): void {
  if (!props.snapshot.channels.find((channel) => channel.id === channelId.value)?.custom) return
  void perform(() => window.networkTest.removeChannel(channelId.value))
}
</script>

<template>
  <div class="dashboard">
    <div class="dashboard-top mode-status-row">
      <div class="mode-control">
        <label for="test-mode">测速规则</label>
        <SelectDropdown
          id="test-mode"
          :model-value="mode"
          label="测速规则"
          menu-placement="below"
          :disabled="busy || snapshot.running || snapshot.paused"
          :options="modeOptions"
          @update:model-value="selectMode"
          @change="changeMode"
        />
      </div>
      <div class="status">
        <span
          class="status-dot"
          :class="{ running: snapshot.running, paused: snapshot.paused }"
        ></span>
        {{
          snapshot.running
            ? `测速中 · ${activeDuration}`
            : snapshot.paused
              ? `已暂停 · ${activeDuration}`
              : record
                ? '本次已结束'
                : '待开始'
        }}
      </div>
    </div>
    <div class="dashboard-rule"></div>
    <div class="hero-row">
      <section
        v-for="group in metricGroups"
        :key="group.key"
        class="metric-group"
        :aria-label="`${group.label}指标`"
      >
        <div v-for="metric in group.metrics" :key="metric.label" class="metric-item">
          <div class="metric-label">{{ metric.label }}</div>
          <div class="metric-value">{{ metric.value }}</div>
        </div>
      </section>
    </div>
    <div class="live-charts">
      <section class="chart-card">
        <div class="chart-heading">
          <div class="chart-title">
            <strong>下行速度</strong><span class="chart-unit">MB/s</span>
          </div>
          <span>{{ bytes(record?.downloadBytes ?? 0) }}</span>
        </div>
        <div class="live-chart">
          <SpeedChart
            title="下行速度"
            :samples="record?.samples ?? []"
            :segments="record?.segments ?? []"
            :channels="snapshot.channels"
            :started-at="record?.startedAt"
            :window-end="curveWindowEnd"
            :tested="testModeForRecord('download')"
          />
        </div>
      </section>
      <section class="chart-card">
        <div class="chart-heading">
          <div class="chart-title">
            <strong>上行速度</strong><span class="chart-unit">MB/s</span>
          </div>
          <span>{{ bytes(record?.uploadBytes ?? 0) }}</span>
        </div>
        <div class="live-chart">
          <SpeedChart
            title="上行速度"
            :samples="record?.uploadSamples ?? []"
            :segments="record?.segments ?? []"
            :channels="snapshot.channels"
            :started-at="record?.startedAt"
            :window-end="curveWindowEnd"
            :tested="testModeForRecord('upload')"
          />
        </div>
      </section>
    </div>
    <div
      class="progress-line"
      :class="{
        inactive: snapshot.settings.maxBytes === 0 && snapshot.settings.maxDurationSec === 0
      }"
    >
      <div :style="{ width: `${progress}%` }"></div>
    </div>
    <div class="progress-caption">
      <span>
        {{
          snapshot.settings.maxBytes > 0
            ? `流量上限进度 ${progress.toFixed(0)}%`
            : snapshot.settings.maxDurationSec > 0
              ? `时间上限进度 ${progress.toFixed(0)}%`
              : '自动停止不限'
        }}
      </span>
    </div>
    <div class="controls">
      <div class="control channel">
        <label for="channel">测速通道</label>
        <SelectDropdown
          id="channel"
          :model-value="selectedChannelValue"
          label="测速通道"
          :options="channelOptions"
          :selected-option="selectedChannelOption"
          :disabled="busy && !snapshot.running && !snapshot.paused"
          searchable
          virtualized
          @update:model-value="selectChannel"
          @change="changeChannel"
        />
      </div>
      <div class="control threads">
        <label for="threads">并发线程</label>
        <SelectDropdown
          id="threads"
          :model-value="threadCount"
          label="并发线程"
          :options="threadOptions"
          @update:model-value="selectThreads"
          @change="changeThreads"
        />
      </div>
      <div class="control limit">
        <label>自动停止条件</label>
        <div class="limit-fields">
          <SelectDropdown
            :model-value="stopMode"
            label="自动停止条件"
            :disabled="snapshot.running"
            :options="stopOptions"
            @update:model-value="selectStopMode"
            @change="saveLimits"
          />
          <div class="limit-editor">
            <template v-if="stopMode === 'traffic'">
              <input
                aria-label="流量上限 GB"
                type="number"
                min="0.1"
                step="0.1"
                v-model.number="limitGb"
                :disabled="snapshot.running"
                @change="saveLimits"
              />
              <span class="limit-unit">GB</span>
            </template>
            <template v-else-if="stopMode === 'time'">
              <input
                aria-label="时间上限分钟"
                type="number"
                min="1"
                step="1"
                v-model.number="durationMinutes"
                :disabled="snapshot.running"
                @change="saveLimits"
              />
              <span class="limit-unit">分钟</span>
            </template>
          </div>
        </div>
      </div>
      <div class="test-actions">
        <button
          v-if="!snapshot.running"
          class="main-action"
          :disabled="busy || (!snapshot.paused && !selectedChannelReady)"
          @click="startOrResume"
        >
          {{ snapshot.paused ? '继续测速' : '开始测速' }}
        </button>
        <button v-else class="pause-action" :disabled="busy" @click="pause">暂停</button>
        <button
          v-if="snapshot.running || snapshot.paused"
          class="stop-action"
          :disabled="busy"
          @click="stop"
        >
          停止
        </button>
      </div>
      <div
        class="add-channel"
        :class="{ 'is-placeholder': !showAddChannelFields }"
        :aria-hidden="!showAddChannelFields"
      >
        <input
          v-model="newLabel"
          :disabled="busy || !showAddChannelFields"
          placeholder="通道名称"
          aria-label="通道名称"
        /><input
          v-model="newUrl"
          :disabled="busy || !showAddChannelFields"
          placeholder="https://测速文件地址"
          aria-label="通道地址"
        /><button :disabled="busy || !showAddChannelFields" @click="addChannel">
          限量检查并添加
        </button>
      </div>
    </div>
    <div class="bottom-tools">
      <button
        :disabled="!showChannelActions"
        :aria-expanded="showAddChannelFields"
        @click="addOpen = !addOpen"
      >
        {{
          showChannelActions
            ? showAddChannelFields
              ? '收起自定义通道'
              : '＋ 添加自定义通道'
            : '自定义通道仅支持下行'
        }}
      </button>
      <button
        :class="{ 'is-placeholder': !showRemoveChannel }"
        :disabled="!showRemoveChannel"
        :aria-hidden="!showRemoveChannel"
        :tabindex="showRemoveChannel ? 0 : -1"
        @click="removeCurrent"
      >
        删除当前自定义通道
      </button>
    </div>
  </div>
</template>
