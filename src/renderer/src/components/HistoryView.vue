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
        ><strong>{{ speed(item.averageBytesPerSec) }}</strong
        ><small>{{ reason(item) }} · {{ bytes(item.totalBytes) }}</small>
      </button>
    </section>
    <section v-if="selected" class="history-detail">
      <div class="detail-top">
        <div>
          <h2>{{ clockTime(selected.startedAt) }}</h2>
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
          <label>平均速度</label><strong>{{ speed(selected.averageBytesPerSec) }}</strong>
        </div>
        <div>
          <label>平均吞吐</label><strong>{{ mbps(selected.averageBytesPerSec) }}</strong>
        </div>
        <div>
          <label>峰值速度</label><strong>{{ speed(selected.peakBytesPerSec) }}</strong>
        </div>
      </div>
      <div class="detail-chart">
        <SpeedChart
          :samples="selected.samples"
          :segments="selected.segments"
          :channels="snapshot.channels"
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
  display: grid;
  grid-template-columns: 310px 1fr;
  gap: 34px;
}
.history-list {
  border-right: 1px solid #ffffff1c;
  padding-right: 24px;
  overflow: auto;
}
.history-list h2,
.history-detail h2 {
  margin: 0;
  font-size: 25px;
  font-weight: 610;
}
.empty,
.history-placeholder {
  color: #91a9a2;
  margin-top: 40px;
}
.history-item {
  display: block;
  width: 100%;
  border: 0;
  border-bottom: 1px solid #ffffff18;
  text-align: left;
  background: transparent;
  color: #e4f0eb;
  padding: 16px 12px;
  cursor: pointer;
}
.history-item.chosen {
  background: #a9edcf15;
  border-radius: 10px;
}
.history-item span,
.history-item strong,
.history-item small {
  display: block;
}
.history-item span {
  font-size: 12px;
  color: #9eb4ad;
}
.history-item strong {
  font-size: 20px;
  margin: 5px 0;
  font-weight: 580;
}
.history-item small {
  font-size: 11px;
  color: #8da7a1;
}
.history-detail {
  overflow: auto;
  padding-right: 8px;
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
  color: #a9edcf;
  font-size: 12px;
}
.detail-times {
  display: flex;
  gap: 24px;
  color: #8ea9a0;
  font-size: 11px;
  margin-top: 18px;
}
.detail-stats {
  display: grid;
  grid-template-columns: repeat(5, 1fr);
  gap: 12px;
  border-block: 1px solid #ffffff20;
  padding: 26px 0;
  margin-top: 32px;
}
.detail-stats label {
  display: block;
  color: #8ea9a0;
  font-size: 11px;
  margin-bottom: 10px;
}
.detail-stats strong {
  font-weight: 580;
  font-size: 16px;
}
.detail-chart {
  height: 260px;
  margin: 22px 0 30px;
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
  border-bottom: 1px solid #ffffff17;
  color: #aabfb8;
  font-size: 12px;
}
.error {
  color: #f0b79d;
  font-size: 12px;
}
</style>
