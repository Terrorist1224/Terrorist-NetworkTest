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
  samples: SpeedSample[]
  segments?: TestSegment[]
  channels?: Channel[]
}>()
const target = ref<HTMLElement | null>(null)
let chart: EChartsType | null = null
let observer: ResizeObserver | null = null

function render(): void {
  if (!chart) return
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
        axisLine: { lineStyle: { color: '#526a66' } },
        axisTick: { show: false },
        axisLabel: { color: '#829d98', fontSize: 11 },
        splitLine: { show: false }
      },
      yAxis: {
        type: 'value',
        min: 0,
        axisLine: { show: false },
        axisTick: { show: false },
        axisLabel: { color: '#829d98', fontSize: 11, formatter: '{value}' },
        splitLine: { lineStyle: { color: '#ffffff14' } },
        name: 'MB/s',
        nameTextStyle: { color: '#829d98' }
      },
      series: [
        {
          type: 'line',
          name: '下载速度',
          showSymbol: props.samples.length <= 1,
          symbolSize: 7,
          smooth: false,
          lineStyle: { color: '#a9edcf', width: 2 },
          itemStyle: { color: '#a9edcf' },
          areaStyle: { color: '#a9edcf', opacity: 0.1 },
          data: props.samples.map((sample) => [sample.at, sample.bytesPerSec / 1024 / 1024]),
          markLine: {
            silent: true,
            symbol: 'none',
            lineStyle: { color: '#e9bd82', type: 'dashed' },
            label: { color: '#e9bd82', fontSize: 10 },
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
  <div ref="target" class="speed-chart" role="img" aria-label="每秒下载速度折线图" />
</template>

<style scoped>
.speed-chart {
  width: 100%;
  height: 100%;
  min-height: 180px;
}
</style>
