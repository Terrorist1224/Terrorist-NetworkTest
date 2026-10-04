<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import type { IpProbeResult } from '../../../shared/types'
import { createIpLocationMapUrl } from '../geo-map'

const result = ref<IpProbeResult | null>(null)
const queryStatus = ref('')
const mapUrl = computed(() => (result.value ? createIpLocationMapUrl(result.value.geo) : null))

onMounted(() => void probe())

async function probe(): Promise<void> {
  result.value = null
  queryStatus.value = '正在查询当前公网出口 IP…'
  try {
    result.value = await window.networkTest.probeIp()
    queryStatus.value = '查询完成；地图标记是 IP 定位估算位置。'
  } catch (error) {
    queryStatus.value = error instanceof Error ? error.message : '公网 IP 查询失败。'
  }
}

function formatTime(timestamp: number): string {
  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  }).format(timestamp)
}

function show(value: string | number | null | undefined): string {
  return value === null || value === undefined || value === '' ? '—' : String(value)
}

function coordinate(value: number | null): string {
  return value === null ? '—' : value.toFixed(4)
}
</script>

<template>
  <div class="ip-probe-view">
    <header class="ip-probe-header"><h1>IP 探测</h1></header>

    <section class="ip-probe-card">
      <div class="ip-probe-card-heading">
        <h2>公网出口地址</h2>
        <span v-if="result" class="ip-probe-source">
          GeoJS · {{ formatTime(result.geoQueriedAt) }}
        </span>
      </div>

      <div v-if="queryStatus" class="ip-query-status" role="status" aria-live="polite">
        {{ queryStatus }}
      </div>

      <div v-if="result" class="ip-content-grid">
        <div class="ip-geo-grid">
          <div class="ip-geo-address">
            <label>公网 IP</label><strong>{{ result.geo.ip }}</strong>
          </div>
          <div>
            <label>国家 / 地区</label><strong>{{ show(result.geo.country) }}</strong>
          </div>
          <div>
            <label>省 / 州</label><strong>{{ show(result.geo.region) }}</strong>
          </div>
          <div>
            <label>城市</label><strong>{{ show(result.geo.city) }}</strong>
          </div>
          <div>
            <label>ASN</label><strong>{{ result.geo.asn ? `AS${result.geo.asn}` : '—' }}</strong>
          </div>
          <div>
            <label>ASN 组织</label><strong>{{ show(result.geo.organization) }}</strong>
          </div>
          <div>
            <label>大陆</label><strong>{{ show(result.geo.continent) }}</strong>
          </div>
          <div>
            <label>时区</label><strong>{{ show(result.geo.timezone) }}</strong>
          </div>
          <div>
            <label>坐标</label>
            <strong
              >{{ coordinate(result.geo.latitude) }}, {{ coordinate(result.geo.longitude) }}</strong
            >
          </div>
          <div>
            <label>定位精度范围</label>
            <strong>{{
              result.geo.accuracyKm == null ? '—' : `约 ${result.geo.accuracyKm} km`
            }}</strong>
          </div>
        </div>

        <section class="ip-map-panel" aria-label="公网 IP 定位地图">
          <h3>IP 定位</h3>
          <iframe
            v-if="mapUrl"
            class="ip-map-frame"
            :src="mapUrl"
            title="公网出口 IP 的估算位置"
            loading="lazy"
            referrerpolicy="strict-origin-when-cross-origin"
          />
          <div v-else class="ip-map-empty" role="status">GeoJS 未返回可用于地图显示的坐标。</div>
          <div class="ip-map-caption">
            <span>IP 定位为网络数据库估算，不代表设备精确位置。</span>
            <span>© OpenStreetMap contributors</span>
          </div>
        </section>
      </div>

      <div v-else-if="!queryStatus" class="ip-probe-empty">
        进入此页后会自动查询当前网络的公网出口 IP。
      </div>
    </section>
  </div>
</template>

<style scoped>
.ip-probe-view {
  height: 100%;
  min-height: 0;
  overflow: auto;
  padding: 26px 30px 32px;
  display: flex;
  flex-direction: column;
  gap: 16px;
  scrollbar-width: thin;
  scrollbar-color: var(--line-strong) transparent;
}
.ip-probe-header h1 {
  margin: 0;
  font-size: 25px;
  line-height: 1.25;
  font-weight: 620;
}
.ip-probe-card {
  min-width: 0;
  padding: 18px;
  border: 1px solid var(--line);
  border-radius: 12px;
  background: var(--panel);
  box-shadow: var(--panel-shadow);
}
.ip-probe-card-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 16px;
}
.ip-probe-card-heading h2 {
  margin: 0;
  font-size: 16px;
  font-weight: 600;
}
.ip-probe-source {
  color: var(--text-tertiary);
  font-size: 11px;
  font-variant-numeric: tabular-nums;
}
.ip-query-status,
.ip-probe-empty {
  margin-top: 12px;
  color: var(--text-secondary);
  font-size: 12px;
  line-height: 1.55;
}
.ip-content-grid {
  display: grid;
  grid-template-columns: minmax(310px, 0.9fr) minmax(420px, 1.1fr);
  align-items: stretch;
  gap: 18px;
  margin-top: 18px;
}
.ip-geo-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  align-content: start;
  gap: 10px;
}
.ip-geo-grid > div {
  min-width: 0;
  padding: 10px 11px;
  border: 1px solid var(--line);
  border-radius: 9px;
  background: var(--panel-raised);
}
.ip-geo-grid .ip-geo-address {
  grid-column: 1 / -1;
}
.ip-geo-grid label {
  display: block;
  margin-bottom: 6px;
  color: var(--text-tertiary);
  font-size: 11px;
}
.ip-geo-grid strong {
  display: block;
  overflow: hidden;
  color: var(--text-primary);
  font-size: 13px;
  font-weight: 560;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.ip-geo-address strong {
  font-size: 20px;
  font-variant-numeric: tabular-nums;
}
.ip-map-panel {
  display: flex;
  min-width: 0;
  min-height: 390px;
  flex-direction: column;
}
.ip-map-panel h3 {
  margin: 0 0 10px;
  color: var(--text-secondary);
  font-size: 13px;
  font-weight: 560;
}
.ip-map-frame,
.ip-map-empty {
  width: 100%;
  min-height: 350px;
  flex: 1 1 auto;
  border: 1px solid var(--line);
  border-radius: 9px;
  background: var(--panel-raised);
}
.ip-map-frame {
  display: block;
}
.ip-map-empty {
  display: grid;
  place-items: center;
  padding: 20px;
  color: var(--text-tertiary);
  font-size: 12px;
  text-align: center;
}
.ip-map-caption {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  margin-top: 8px;
  color: var(--text-tertiary);
  font-size: 10px;
  line-height: 1.5;
}
@media (max-width: 1050px) {
  .ip-content-grid {
    grid-template-columns: 1fr;
  }
  .ip-map-panel {
    min-height: 350px;
  }
}
@media (max-width: 600px) {
  .ip-probe-view {
    padding: 18px;
  }
  .ip-map-caption {
    flex-direction: column;
    gap: 3px;
  }
}
</style>
