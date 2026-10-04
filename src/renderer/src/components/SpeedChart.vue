<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { init, use, type EChartsType } from 'echarts/core'
import { LineChart } from 'echarts/charts'
import { GridComponent, TooltipComponent, MarkLineComponent } from 'echarts/components'
import { CanvasRenderer } from 'echarts/renderers'
import type { Channel, SpeedSample, TestSegment } from '../../../shared/types'
import { threadLabel } from '../format'

use([LineChart, GridComponent, TooltipComponent, MarkLineComponent, CanvasRenderer])
const props = defineProps<{
  title: string
  tested: boolean
  samples: SpeedSample[]
  segments?: TestSegment[]
  channels?: Channel[]
}>()
const target = ref<HTMLElement | null>(null)
let chart: EChartsType | null = null
let observer: ResizeObserver | null = null

function themeColor(name: string, fallback: string): string {
  return target.value
    ? getComputedStyle(target.value).getPropertyValue(name).trim() || fallback
    : fallback
}

function render(): void {
  if (!chart) return
  const textTertiary = themeColor('--text-tertiary', '#838a91')
  const line = themeColor('--line', '#3b4046')
  const lineStrong = themeColor('--line-strong', '#50565d')
  const chartLine =
    props.title === '上行速度'
      ? themeColor('--chart-line-secondary', '#9fa4a9')
      : themeColor('--chart-line', '#bec2c6')
  const chartMarker = themeColor('--chart-marker', '#c4c4c4')
  const markers = (props.segments ?? []).slice(1).map((segment) => ({
    xAxis: segment.at,
    label: {
      formatter: `${props.channels?.find((channel) => channel.id === segment.channelId)?.label ?? segment.channelId} · ${threadLabel(segment.threadCount)}`
    }
  }))
  chart.setOption(
    {
      animation: false,
      backgroundColor: 'transparent',
      grid: { left: 6, right: 48, top: 18, bottom: 28, containLabel: true },
      tooltip: {
        trigger: 'axis',
        valueFormatter: (value: unknown) => `${Number(value).toFixed(1)} MB/s`
      },
      xAxis: {
        type: 'time',
        axisLine: { lineStyle: { color: lineStrong } },
        axisTick: { show: false },
        axisLabel: { color: textTertiary, fontSize: 11, hideOverlap: true },
        splitLine: { show: false }
      },
      yAxis: {
        type: 'value',
        min: 0,
        axisLine: { show: false },
        axisTick: { show: false },
        axisLabel: { color: textTertiary, fontSize: 11, formatter: '{value}' },
        splitLine: { lineStyle: { color: line } }
      },
      series: [
        {
          type: 'line',
          name: props.title,
          showSymbol: props.samples.length <= 1,
          symbolSize: 7,
          smooth: false,
          lineStyle: { color: chartLine, width: 2 },
          itemStyle: { color: chartLine },
          areaStyle: { color: chartLine, opacity: 0.08 },
          data: props.samples.map((sample) => [sample.at, sample.bytesPerSec / 1024 / 1024]),
          markLine: {
            silent: true,
            symbol: 'none',
            lineStyle: { color: chartMarker, type: 'dashed' },
            label: { color: chartMarker, fontSize: 10 },
            data: markers
          }
        }
      ]
    },
    true
  )
}

onMounted(() => {
  if (!target.value) return
  chart = init(target.value, undefined, { renderer: 'canvas' })
  observer = new ResizeObserver(() => chart?.resize())
  observer.observe(target.value)
  render()
})
watch(() => [props.samples, props.segments], render, { deep: true })
onBeforeUnmount(() => {
  observer?.disconnect()
  chart?.dispose()
  chart = null
})
</script>

<template>
  <div class="speed-chart-wrap">
    <div ref="target" class="speed-chart" role="img" :aria-label="`每秒${title}折线图`" />
    <div v-if="!samples.length" class="speed-chart-empty">
      {{ tested ? '等待数据' : '本次未测试' }}
    </div>
  </div>
</template>

<style scoped>
.speed-chart-wrap {
  width: 100%;
  height: 100%;
  min-height: 0;
  position: relative;
}
.speed-chart {
  width: 100%;
  height: 100%;
  min-height: 0;
}
.speed-chart-empty {
  position: absolute;
  inset: 0;
  display: grid;
  place-items: center;
  color: var(--text-tertiary);
  font-size: 12px;
  pointer-events: none;
}
</style>
