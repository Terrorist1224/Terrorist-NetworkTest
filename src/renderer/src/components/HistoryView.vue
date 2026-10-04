<script setup lang="ts">
import { onMounted, ref } from 'vue'
import type { AppSnapshot, TestRecord } from '../../../shared/types'
import { bytes, clockTime, duration, mbps, speed, threadLabel } from '../format'
import SpeedChart from './SpeedChart.vue'

defineProps<{ snapshot: AppSnapshot }>()
const records = ref<TestRecord[]>([])
const selected = ref<TestRecord | null>(null)
const loading = ref(true)

onMounted(async () => {
  try {
    records.value = await window.networkTest.history()
    selected.value = records.value[0] ?? null
  } finally {
    loading.value = false
  }
})

function reason(record: TestRecord): string {
  const map = {
    manual: '手动停止',
    'time-limit': '达到时间上限',
    'traffic-limit': '达到流量上限',
    'channel-error': '通道错误',
    quit: '退出程序',
    interrupted: '异常中断'
  }
  return record.stopReason ? map[record.stopReason] : '运行中'
}

function modeLabel(record: TestRecord): string {
  return record.mode === 'upload' ? '上行' : record.mode === 'parallel' ? '并行' : '下行'
}
</script>

<template>
  <div class="history-layout">
    <section class="history-list">
      <h2>历史记录</h2>
      <div v-if="loading" class="empty">读取中…</div>
      <div v-else-if="!records.length" class="empty">尚无测速记录</div>
      <button
        v-for="item in records"
        :key="item.id"
        class="history-item"
        :class="{ chosen: selected?.id === item.id }"
        @click="selected = item"
      >
        <span>{{ clockTime(item.startedAt) }}</span
        ><strong>{{ modeLabel(item) }}</strong
        ><small
          >下行 {{ speed(item.downloadAverageBytesPerSec) }} · 上行
          {{ speed(item.uploadAverageBytesPerSec) }}</small
        ><small>{{ reason(item) }} · {{ bytes(item.totalBytes) }}</small>
      </button>
    </section>
    <section v-if="selected" class="history-detail">
      <div class="detail-top">
        <div>
          <h2>{{ clockTime(selected.startedAt) }} · {{ modeLabel(selected) }}</h2>
        </div>
        <span class="detail-status">{{ reason(selected) }}</span>
      </div>
      <div class="detail-times">
        <span>启动 {{ clockTime(selected.startedAt) }}</span>
        <span>结束 {{ clockTime(selected.endedAt ?? selected.startedAt) }}</span>
      </div>
      <div class="detail-stats">
        <div>
          <label>运行时长</label><strong>{{ duration(selected.activeDurationMs) }}</strong>
        </div>
        <div>
          <label>总流量</label><strong>{{ bytes(selected.totalBytes) }}</strong>
        </div>
        <div>
          <label>下行总量</label><strong>{{ bytes(selected.downloadBytes) }}</strong>
        </div>
        <div>
          <label>上行总量</label><strong>{{ bytes(selected.uploadBytes) }}</strong>
        </div>
        <div>
          <label>下行平均 / 峰值</label
          ><strong
            >{{ speed(selected.downloadAverageBytesPerSec) }} /
            {{ speed(selected.downloadPeakBytesPerSec) }}</strong
          >
        </div>
        <div>
          <label>上行平均 / 峰值</label
          ><strong
            >{{ speed(selected.uploadAverageBytesPerSec) }} /
            {{ speed(selected.uploadPeakBytesPerSec) }}</strong
          >
        </div>
        <div>
          <label>平均吞吐（上下行合计）</label
          ><strong>{{ mbps(selected.averageBytesPerSec) }}</strong>
        </div>
      </div>
      <div class="detail-chart">
        <SpeedChart
          title="下行速度"
          :samples="selected.samples"
          :segments="selected.segments"
          :channels="snapshot.channels"
          :tested="selected.mode !== 'upload'"
        />
        <SpeedChart
          title="上行速度"
          :samples="selected.uploadSamples"
          :segments="selected.segments"
          :channels="snapshot.channels"
          :tested="selected.mode !== 'download'"
        />
      </div>
      <h3>配置分段</h3>
      <div class="segment" v-for="(segment, index) in selected.segments" :key="index">
        <span>{{ clockTime(segment.at) }}</span
        ><span>{{
          snapshot.channels.find((channel) => channel.id === segment.channelId)?.label ??
          segment.channelId
        }}</span
        ><span>{{ threadLabel(segment.threadCount) }}</span
        ><span>{{ bytes((segment.endBytes ?? selected.totalBytes) - segment.startBytes) }}</span>
      </div>
      <p v-if="selected.error" class="error">{{ selected.error }}</p>
    </section>
    <div v-else class="history-placeholder">选择一条记录查看曲线</div>
  </div>
</template>

<style scoped>
.history-layout {
  height: 100%;
  min-height: 0;
  display: grid;
  grid-template-rows: minmax(0, 1fr);
  grid-template-columns: 310px 1fr;
  gap: 34px;
}
.history-list {
  min-height: 0;
  padding: 18px 16px;
  border: 1px solid var(--line);
  border-radius: 12px;
  background: var(--panel);
  overflow: auto;
  scrollbar-width: none;
}
.history-list::-webkit-scrollbar,
.history-detail::-webkit-scrollbar {
  display: none;
}
.history-list h2,
.history-detail h2 {
  margin: 0;
  font-size: 25px;
  font-weight: 610;
}
.empty,
.history-placeholder {
  color: var(--text-tertiary);
  margin-top: 40px;
}
.history-item {
  display: block;
  width: 100%;
  border: 0;
  border-bottom: 1px solid var(--line);
  text-align: left;
  background: transparent;
  color: var(--text-primary);
  padding: 16px 12px;
  cursor: pointer;
}
.history-item.chosen {
  background: var(--accent-wash);
  border-radius: 10px;
}
.history-item span,
.history-item strong,
.history-item small {
  display: block;
}
.history-item span {
  font-size: 12px;
  color: var(--text-secondary);
}
.history-item strong {
  font-size: 20px;
  margin: 5px 0;
  font-weight: 580;
}
.history-item small {
  font-size: 11px;
  color: var(--text-tertiary);
}
.history-detail {
  min-height: 0;
  overflow: auto;
  scrollbar-width: none;
  padding: 18px;
  border: 1px solid var(--line);
  border-radius: 12px;
  background: var(--app-surface);
}
.detail-top {
  display: flex;
  justify-content: space-between;
  align-items: center;
}
.detail-top h2 {
  margin-top: 8px;
}
.detail-status {
  color: var(--text-secondary);
  font-size: 12px;
}
.detail-times {
  display: flex;
  gap: 24px;
  color: var(--text-tertiary);
  font-size: 11px;
  margin-top: 18px;
}
.detail-stats {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 12px;
  padding: 0;
  margin-top: 24px;
}
.detail-stats > div {
  min-width: 0;
  padding: 12px;
  border: 1px solid var(--line);
  border-radius: 10px;
  background: var(--panel);
}
.detail-stats label {
  display: block;
  color: var(--text-tertiary);
  font-size: 11px;
  margin-bottom: 10px;
}
.detail-stats strong {
  font-weight: 580;
  font-size: 16px;
  overflow-wrap: anywhere;
}
.detail-chart {
  min-height: 260px;
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  grid-template-rows: minmax(0, 1fr);
  gap: 14px;
  margin: 22px 0 30px;
}
.detail-chart > :deep(.speed-chart-wrap) {
  height: 240px;
  padding: 10px;
  border: 1px solid var(--line);
  border-radius: 10px;
  background: var(--panel);
}
.history-detail h3 {
  font-size: 14px;
  font-weight: 550;
}
.segment {
  display: grid;
  grid-template-columns: 1.5fr 1.5fr 1fr 1fr;
  gap: 10px;
  padding: 12px 0;
  border-bottom: 1px solid var(--line);
  color: var(--text-secondary);
  font-size: 12px;
}
.error {
  color: #f0b79d;
  font-size: 12px;
}
@media (max-width: 1100px) {
  .history-layout {
    grid-template-columns: 250px minmax(0, 1fr);
    gap: 20px;
  }
  .detail-stats {
    grid-template-columns: repeat(3, 1fr);
  }
}
@media (max-width: 820px) {
  .history-layout {
    grid-template-columns: 1fr;
    grid-template-rows: 220px minmax(0, 1fr);
    gap: 12px;
  }
  .history-list {
    max-height: none;
    min-height: 0;
    border: 1px solid var(--line);
    padding: 14px;
  }
}
</style>
