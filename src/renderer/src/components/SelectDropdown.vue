<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue'

// Use one custom popup so Windows never chooses different native menu directions per control.
interface SelectOption {
  label: string
  value: string | number
  group?: string
}

const props = defineProps<{
  id?: string
  label: string
  modelValue: string | number
  options: SelectOption[]
  disabled?: boolean
}>()

const emit = defineEmits<{
  'update:modelValue': [value: string | number]
  change: [value: string | number]
}>()

const root = ref<HTMLElement | null>(null)
const open = ref(false)
const selected = computed(() => props.options.find((option) => option.value === props.modelValue))
const groups = computed(() => {
  const result: Array<{ label?: string; options: SelectOption[] }> = []
  for (const option of props.options) {
    let group = result.find((item) => item.label === option.group)
    if (!group) {
      group = { label: option.group, options: [] }
      result.push(group)
    }
    group.options.push(option)
  }
  return result
})

function focusSelected(): void {
  const options = root.value?.querySelectorAll<HTMLButtonElement>('[role="option"]')
  const index = props.options.findIndex((option) => option.value === props.modelValue)
  options?.[Math.max(0, index)]?.focus()
}

function toggle(): void {
  if (props.disabled) return
  open.value = !open.value
  if (open.value) void nextTick(focusSelected)
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

function onKeydown(event: KeyboardEvent): void {
  if (!open.value && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) {
    event.preventDefault()
    open.value = true
    void nextTick(focusSelected)
    return
  }
  if (event.key === 'Escape' && open.value) {
    event.preventDefault()
    close(true)
    return
  }
  if (
    event.key !== 'ArrowDown' &&
    event.key !== 'ArrowUp' &&
    event.key !== 'Home' &&
    event.key !== 'End'
  )
    return
  if (!open.value) return

  event.preventDefault()
  const options = Array.from(
    root.value?.querySelectorAll<HTMLButtonElement>('[role="option"]') ?? []
  )
  if (!options.length) return
  const currentIndex = options.indexOf(document.activeElement as HTMLButtonElement)
  // Arrow-key movement wraps through the options; Home and End jump to either boundary.
  const nextIndex =
    event.key === 'Home'
      ? 0
      : event.key === 'End'
        ? options.length - 1
        : (currentIndex + (event.key === 'ArrowDown' ? 1 : -1) + options.length) % options.length
  options[nextIndex]?.focus()
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
      <span class="speed-select__chevron" aria-hidden="true">⌃</span>
    </button>
    <div v-if="open" class="speed-select__menu" role="listbox" :aria-label="label">
      <div
        v-for="(group, groupIndex) in groups"
        :key="group.label ?? `group-${groupIndex}`"
        role="group"
        :aria-label="group.label"
      >
        <div v-if="group.label" class="speed-select__group">{{ group.label }}</div>
        <button
          v-for="option in group.options"
          :key="String(option.value)"
          type="button"
          role="option"
          class="speed-select__option"
          :aria-selected="option.value === modelValue"
          @click="choose(option)"
        >
          <span>{{ option.label }}</span>
          <span v-if="option.value === modelValue" class="speed-select__check" aria-hidden="true"
            >✓</span
          >
        </button>
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
  border: 1px solid #ffffff24;
  border-radius: 10px;
  outline: 0;
  color: #edf7f1;
  background: #ffffff05;
  text-align: left;
  font-size: 12px;
  transition:
    background-color 120ms ease,
    border-color 120ms ease;
}
.speed-select__trigger:hover {
  border-color: #ffffff38;
  background: #ffffff0b;
}
.speed-select__trigger:focus-visible,
.speed-select.is-open .speed-select__trigger {
  border-color: #9fdfceaa;
}
.speed-select__trigger:disabled {
  color: #91a69f;
  cursor: not-allowed;
}
.speed-select__value {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.speed-select__chevron {
  flex: 0 0 auto;
  color: #9cafaa;
  font-size: 15px;
  line-height: 1;
}
.speed-select__menu {
  position: absolute;
  z-index: 30;
  right: 0;
  bottom: calc(100% + 7px);
  left: 0;
  max-height: min(280px, 65vh);
  overflow: auto;
  padding: 5px;
  border: 1px solid #ffffff24;
  border-radius: 11px;
  background: rgb(24 36 37 / 98%);
  box-shadow: 0 12px 28px #0007;
}
.speed-select__group:not(:first-child) {
  margin-top: 5px;
  padding-top: 5px;
  border-top: 1px solid #ffffff18;
}
.speed-select__group {
  padding: 5px 9px 4px;
  color: #78968c;
  font-size: 10px;
}
.speed-select__option {
  width: 100%;
  min-height: 33px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 0 9px;
  border: 0;
  border-radius: 7px;
  color: #d7e6df;
  background: transparent;
  text-align: left;
  font-size: 12px;
}
.speed-select__option:hover,
.speed-select__option:focus-visible,
.speed-select__option[aria-selected='true'] {
  outline: 0;
  color: #caffea;
  background: #a0e6ce17;
}
.speed-select__check {
  color: #9fdfce;
}
</style>
