<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue'

// Use one custom popup so Windows never chooses different native menu directions per control.
interface SelectOption {
  label: string
  value: string | number
  group?: string
  healthStatus?: 'checking' | 'fast' | 'slow' | 'unavailable'
  healthTone?: string
  healthText?: string
  healthDescription?: string
}

type MenuRow =
  | { kind: 'group'; key: string; label: string; rowIndex: number }
  | {
      kind: 'option'
      key: string
      option: SelectOption
      optionIndex: number
      rowIndex: number
    }

const ROW_HEIGHT = 36
const VIEWPORT_HEIGHT = 280

const props = defineProps<{
  id?: string
  label: string
  modelValue: string | number
  options: SelectOption[]
  selectedOption?: SelectOption
  disabled?: boolean
  menuPlacement?: 'above' | 'below'
  searchable?: boolean
  virtualized?: boolean
}>()

const emit = defineEmits<{
  'update:modelValue': [value: string | number]
  change: [value: string | number]
}>()

const root = ref<HTMLElement | null>(null)
const list = ref<HTMLElement | null>(null)
const searchInput = ref<HTMLInputElement | null>(null)
const open = ref(false)
const searchText = ref('')
const scrollTop = ref(0)
const focusedOptionIndex = ref(-1)
const selected = computed(
  () =>
    props.options.find((option) => option.value === props.modelValue) ??
    (props.selectedOption?.value === props.modelValue ? props.selectedOption : undefined)
)
const filteredOptions = computed(() => {
  const query = searchText.value.trim().toLocaleLowerCase()
  if (!query) return props.options
  return props.options.filter((option) =>
    [option.label, option.group].some((value) => value?.toLocaleLowerCase().includes(query))
  )
})
const rows = computed<MenuRow[]>(() => {
  const result: MenuRow[] = []
  let previousGroup: string | undefined
  filteredOptions.value.forEach((option, optionIndex) => {
    if (option.group && option.group !== previousGroup) {
      result.push({
        kind: 'group',
        key: `group-${optionIndex}-${option.group}`,
        label: option.group,
        rowIndex: result.length
      })
    }
    previousGroup = option.group
    result.push({
      kind: 'option',
      key: String(option.value),
      option,
      optionIndex,
      rowIndex: result.length
    })
  })
  return result
})
const virtualizedActive = computed(() => props.virtualized && rows.value.length > 40)
const renderedRows = computed(() => {
  if (!virtualizedActive.value) return rows.value
  const start = Math.max(0, Math.floor(scrollTop.value / ROW_HEIGHT) - 4)
  const end = Math.min(
    rows.value.length,
    Math.ceil((scrollTop.value + VIEWPORT_HEIGHT) / ROW_HEIGHT) + 4
  )
  return rows.value.slice(start, end)
})
const optionRowIndexes = computed(
  () =>
    new Map(
      rows.value.flatMap((row) => (row.kind === 'option' ? [[row.optionIndex, row.rowIndex]] : []))
    )
)

function rowStyle(rowIndex: number): Record<string, string> | undefined {
  if (!virtualizedActive.value) return undefined
  return {
    position: 'absolute',
    top: `${rowIndex * ROW_HEIGHT}px`,
    left: '0',
    right: '0',
    height: `${ROW_HEIGHT}px`
  }
}

function onScroll(): void {
  scrollTop.value = list.value?.scrollTop ?? 0
}

function scrollOptionIntoView(optionIndex: number): void {
  const rowIndex = optionRowIndexes.value.get(optionIndex)
  const element = list.value
  if (rowIndex === undefined || !element || !virtualizedActive.value) return
  const top = rowIndex * ROW_HEIGHT
  const bottom = top + ROW_HEIGHT
  let next = element.scrollTop
  if (top < next) next = top
  else if (bottom > next + VIEWPORT_HEIGHT) next = bottom - VIEWPORT_HEIGHT
  if (next !== element.scrollTop) {
    element.scrollTop = next
    scrollTop.value = next
  }
}

async function focusOption(index: number): Promise<void> {
  const options = filteredOptions.value
  if (!options.length) return
  const normalized = (index + options.length) % options.length
  focusedOptionIndex.value = normalized
  scrollOptionIntoView(normalized)
  await nextTick()
  root.value?.querySelector<HTMLButtonElement>(`[data-option-index="${normalized}"]`)?.focus()
}

function focusSelected(): void {
  const index = filteredOptions.value.findIndex((option) => option.value === props.modelValue)
  if (index >= 0) {
    focusedOptionIndex.value = index
    scrollOptionIntoView(index)
  } else {
    focusedOptionIndex.value = filteredOptions.value.length ? 0 : -1
  }
  if (props.searchable) {
    searchInput.value?.focus()
  } else if (focusedOptionIndex.value >= 0) {
    void focusOption(focusedOptionIndex.value)
  }
}

function toggle(): void {
  if (props.disabled) return
  if (open.value) {
    close()
    return
  }
  open.value = true
  searchText.value = ''
  scrollTop.value = 0
  void nextTick(focusSelected)
}

function close(restoreFocus = false): void {
  open.value = false
  if (restoreFocus) void nextTick(() => root.value?.querySelector('button')?.focus())
}

function choose(option: SelectOption): void {
  emit('update:modelValue', option.value)
  emit('change', option.value)
  close(true)
}

function onSearchInput(): void {
  if (list.value) list.value.scrollTop = 0
  scrollTop.value = 0
  focusedOptionIndex.value = filteredOptions.value.length ? 0 : -1
}

function onKeydown(event: KeyboardEvent): void {
  if (event.key === 'Escape' && open.value) {
    event.preventDefault()
    close(true)
    return
  }
  if (!open.value) {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      open.value = true
      searchText.value = ''
      scrollTop.value = 0
      void nextTick(focusSelected)
    }
    return
  }
  if (event.target === searchInput.value) {
    if (event.key === 'ArrowDown' && filteredOptions.value.length) {
      event.preventDefault()
      void focusOption(focusedOptionIndex.value < 0 ? 0 : focusedOptionIndex.value)
    }
    return
  }
  if (
    event.key !== 'ArrowDown' &&
    event.key !== 'ArrowUp' &&
    event.key !== 'Home' &&
    event.key !== 'End'
  )
    return

  event.preventDefault()
  const active = document.activeElement?.closest<HTMLButtonElement>('[data-option-index]')
  const current = active ? Number(active.dataset.optionIndex) : focusedOptionIndex.value
  const nextIndex =
    event.key === 'Home'
      ? 0
      : event.key === 'End'
        ? filteredOptions.value.length - 1
        : current < 0
          ? 0
          : current + (event.key === 'ArrowDown' ? 1 : -1)
  void focusOption(nextIndex)
}

function onPointerDown(event: PointerEvent): void {
  if (open.value && !root.value?.contains(event.target as Node)) close()
}

onMounted(() => document.addEventListener('pointerdown', onPointerDown))
onBeforeUnmount(() => document.removeEventListener('pointerdown', onPointerDown))
</script>

<template>
  <div ref="root" class="speed-select" :class="{ 'is-open': open }" @keydown="onKeydown">
    <button
      :id="id"
      type="button"
      class="speed-select__trigger"
      :aria-label="label"
      aria-haspopup="listbox"
      :aria-expanded="open"
      :disabled="disabled"
      @click="toggle"
    >
      <span class="speed-select__value">{{ selected?.label ?? '请选择' }}</span>
      <span
        v-if="selected?.healthText"
        class="speed-select__health"
        :class="`is-${selected.healthTone ?? selected.healthStatus}`"
        :aria-label="selected.healthDescription"
      >
        <span class="speed-select__health-dot" aria-hidden="true"></span>
        {{ selected.healthText }}
      </span>
      <span class="speed-select__chevron" aria-hidden="true">⌃</span>
    </button>
    <div
      v-if="open"
      class="speed-select__menu"
      :class="{ 'opens-below': props.menuPlacement === 'below' }"
    >
      <input
        v-if="searchable"
        ref="searchInput"
        v-model="searchText"
        class="speed-select__search"
        type="search"
        :aria-label="`${label}搜索`"
        placeholder="搜索城市或运营商"
        @input="onSearchInput"
      />
      <div
        ref="list"
        class="speed-select__list"
        role="listbox"
        :aria-label="label"
        @scroll="onScroll"
      >
        <div
          class="speed-select__rows"
          :style="virtualizedActive ? { height: `${rows.length * ROW_HEIGHT}px` } : undefined"
        >
          <template v-for="row in renderedRows" :key="row.key">
            <div
              v-if="row.kind === 'group'"
              class="speed-select__group"
              :style="rowStyle(row.rowIndex)"
              aria-hidden="true"
            >
              {{ row.label }}
            </div>
            <button
              v-else
              type="button"
              role="option"
              class="speed-select__option"
              :style="rowStyle(row.rowIndex)"
              :data-option-index="row.optionIndex"
              :aria-posinset="row.optionIndex + 1"
              :aria-setsize="filteredOptions.length"
              :aria-selected="row.option.value === modelValue"
              :aria-label="
                [row.option.label, row.option.healthText, row.option.healthDescription]
                  .filter(Boolean)
                  .join('，')
              "
              @click="choose(row.option)"
            >
              <span class="speed-select__option-label">{{ row.option.label }}</span>
              <span class="speed-select__option-meta">
                <span
                  v-if="row.option.healthText"
                  class="speed-select__health"
                  :class="`is-${row.option.healthTone ?? row.option.healthStatus}`"
                  :title="row.option.healthDescription"
                >
                  <span class="speed-select__health-dot" aria-hidden="true"></span>
                  {{ row.option.healthText }}
                </span>
                <span
                  v-if="row.option.value === modelValue"
                  class="speed-select__check"
                  aria-hidden="true"
                  >✓</span
                >
              </span>
            </button>
          </template>
          <div v-if="!filteredOptions.length" class="speed-select__empty">没有匹配的节点</div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.speed-select {
  position: relative;
  width: 100%;
  min-width: 0;
}
.speed-select__trigger {
  width: 100%;
  height: 39px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 0 10px;
  border: 1px solid var(--line-strong);
  border-radius: 10px;
  outline: 0;
  color: var(--text-primary);
  background: var(--control-bg);
  text-align: left;
  font-size: 12px;
  transition:
    background-color 120ms ease,
    border-color 120ms ease;
}
.speed-select__trigger:hover {
  border-color: var(--line-strong);
  background: var(--panel-raised);
}
.speed-select__trigger:focus-visible,
.speed-select.is-open .speed-select__trigger {
  border-color: var(--accent);
}
.speed-select__trigger:disabled {
  color: var(--text-tertiary);
  cursor: not-allowed;
}
.speed-select__value {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.speed-select__health {
  display: inline-flex;
  flex: 0 0 auto;
  align-items: center;
  gap: 5px;
  color: var(--text-secondary);
  font-size: 11px;
  white-space: nowrap;
}
.speed-select__health.is-fast {
  color: #65d69b;
}
.speed-select__health.is-slow {
  color: #70adff;
}
.speed-select__health.is-yellow {
  color: #e8c45f;
}
.speed-select__health.is-unavailable {
  color: #ff7777;
}
.speed-select__health-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: currentColor;
  box-shadow: 0 0 7px color-mix(in srgb, currentColor 45%, transparent);
}
.speed-select__chevron {
  flex: 0 0 auto;
  color: var(--text-secondary);
  font-size: 15px;
  line-height: 1;
}
.speed-select__menu {
  position: absolute;
  z-index: 30;
  right: 0;
  bottom: calc(100% + 7px);
  left: 0;
  display: flex;
  flex-direction: column;
  gap: 5px;
  max-height: min(340px, 75vh);
  overflow: hidden;
  padding: 5px;
  border: 1px solid var(--line-strong);
  border-radius: 11px;
  background: var(--panel-raised);
  box-shadow: 0 12px 28px rgb(0 0 0 / 42%);
}
.speed-select__menu.opens-below {
  top: calc(100% + 7px);
  bottom: auto;
}
.speed-select__search {
  flex: 0 0 auto;
  height: 34px;
  padding: 0 9px;
  border: 1px solid var(--line);
  border-radius: 7px;
  outline: 0;
  color: var(--text-primary);
  background: var(--control-bg);
  font-size: 12px;
}
.speed-select__search:focus {
  border-color: var(--accent);
}
.speed-select__search::placeholder {
  color: var(--text-tertiary);
}
.speed-select__list {
  position: relative;
  max-height: min(280px, 65vh);
  overflow: auto;
  overscroll-behavior: contain;
}
.speed-select__rows {
  position: relative;
  min-width: 0;
}
.speed-select__group {
  height: 36px;
  display: flex;
  align-items: center;
  padding: 0 9px;
  color: var(--text-tertiary);
  font-size: 10px;
}
.speed-select__group:not(:first-child) {
  border-top: 1px solid var(--line);
}
.speed-select__option {
  width: 100%;
  height: 36px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 0 9px;
  border: 0;
  border-radius: 7px;
  color: var(--text-secondary);
  background: transparent;
  text-align: left;
  font-size: 12px;
}
.speed-select__option-label {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.speed-select__option-meta {
  display: inline-flex;
  flex: 0 0 auto;
  align-items: center;
  gap: 9px;
}
.speed-select__option:hover,
.speed-select__option:focus-visible,
.speed-select__option[aria-selected='true'] {
  outline: 0;
  color: var(--text-primary);
  background: var(--accent-wash);
}
.speed-select__check {
  color: var(--accent);
}
.speed-select__empty {
  padding: 12px 9px;
  color: var(--text-secondary);
  font-size: 12px;
}
</style>
