<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { AppSnapshot, StopMode } from '../../../shared/types'
import { bytes, duration, mbps, speed, threadLabel } from '../format'
import SelectDropdown from './SelectDropdown.vue'
import SpeedChart from './SpeedChart.vue'

const props = defineProps<{ snapshot: AppSnapshot }>()
const emit = defineEmits<{ error: [message: string] }>()
const channelId = ref('cloudflare')
const threadCount = ref(8)
const stopMode = ref<StopMode>('unlimited')
const durationMinutes = ref<number | string>('')
const limitGb = ref<number | string>('')
const addOpen = ref(false)
const newLabel = ref('')
const newUrl = ref('')
const busy = ref(false)
const channelOptions = computed(() => {
  const groups = [
    {
      label: '全球通道',
      options: props.snapshot.channels.filter((item) => item.region === 'global')
    },
    {
      label: '国内通道',
      options: props.snapshot.channels.filter((item) => item.region === 'domestic')
    },
    { label: '自定义通道', options: props.snapshot.channels.filter((item) => item.custom) }
  ]
  return groups.flatMap((group) =>
    group.options.map((channel) => ({
      label: channel.label,
      value: channel.id,
      group: group.label
    }))
  )
})
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
const currentSpeed = computed(() => record.value?.samples.at(-1)?.bytesPerSec ?? 0)
const activeDuration = computed(() => duration(record.value?.activeDurationMs ?? 0))
const progress = computed(() => {
  const { maxBytes, maxDurationSec } = props.snapshot.settings
  if (maxBytes > 0) return Math.min(100, ((record.value?.totalBytes ?? 0) / maxBytes) * 100)
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
    channelId: channelId.value,
    threadCount: Number(threadCount.value),
    ...limits
  }
}

function startOrResume(): void {
  void perform(() =>
    props.snapshot.paused ? window.networkTest.resume() : window.networkTest.start(settings())
  )
}
function pause(): void {
  void perform(() => window.networkTest.pause())
}
function stop(): void {
  void perform(() => window.networkTest.stop())
}

function changeChannel(): void {
  void perform(() => window.networkTest.changeChannel(channelId.value))
}
function selectChannel(value: string | number): void {
  channelId.value = String(value)
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
    await window.networkTest.changeChannel(channelId.value)
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
    <div class="dashboard-top status-row">
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
      <div>
        <div class="metric-label">
          {{
            snapshot.running ? '当前下载速度' : snapshot.paused ? '暂停时平均速度' : '上次平均速度'
          }}
        </div>
        <div class="hero-speed">
          {{
            speed(snapshot.running ? currentSpeed : (record?.averageBytesPerSec ?? 0)).split(
              ' '
            )[0]
          }}<span>MB/s</span>
        </div>
      </div>
      <div class="side-metrics">
        <div>
          <label>实测吞吐</label
          ><strong
            >{{
              mbps(snapshot.running ? currentSpeed : (record?.averageBytesPerSec ?? 0)).split(
                ' '
              )[0]
            }}
            <small>Mbps</small></strong
          >
        </div>
        <div>
          <label>已用流量</label><strong>{{ bytes(record?.totalBytes ?? 0) }}</strong>
        </div>
      </div>
    </div>
    <div class="chart-heading"><strong>每秒速度</strong></div>
    <div class="live-chart">
      <SpeedChart
        :samples="record?.samples ?? []"
        :segments="record?.segments ?? []"
        :channels="snapshot.channels"
      />
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
      <span>
        {{
          snapshot.settings.maxBytes > 0
            ? `${bytes(record?.totalBytes ?? 0)} / ${bytes(snapshot.settings.maxBytes)}`
            : snapshot.settings.maxDurationSec > 0
              ? `${activeDuration} / ${duration(snapshot.settings.maxDurationSec * 1000)}`
              : `${bytes(record?.totalBytes ?? 0)} 已下载`
        }}
      </span>
    </div>
    <div class="controls">
      <div class="control channel">
        <label for="channel">测速通道</label>
        <SelectDropdown
          id="channel"
          :model-value="channelId"
          label="测速通道"
          :options="channelOptions"
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
          :disabled="busy"
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
    </div>
    <div class="bottom-tools">
      <button @click="addOpen = !addOpen">
        {{ addOpen ? '收起自定义通道' : '＋ 添加自定义通道' }}</button
      ><button
        v-if="
          snapshot.channels.find((channel) => channel.id === channelId)?.custom &&
          !snapshot.running &&
          !snapshot.paused
        "
        @click="removeCurrent"
      >
        删除当前自定义通道
      </button>
    </div>
    <div v-if="addOpen" class="add-channel">
      <input v-model="newLabel" placeholder="通道名称" aria-label="通道名称" /><input
        v-model="newUrl"
        placeholder="https://测速文件地址"
        aria-label="通道地址"
      /><button :disabled="busy" @click="addChannel">限量检查并添加</button>
    </div>
    <p v-if="snapshot.error" class="inline-error">{{ snapshot.error }}</p>
  </div>
</template>
