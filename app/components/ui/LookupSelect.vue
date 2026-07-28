<script setup lang="ts">
import type { LookupOption } from '~/lib/kit/lookup'
import { useDebounceFn, useLocalStorage } from '@vueuse/core'
import {
  ComboboxAnchor,
  ComboboxContent,
  ComboboxGroup,
  ComboboxInput,
  ComboboxItem,
  ComboboxItemIndicator,
  ComboboxLabel,
  ComboboxPortal,
  ComboboxRoot,
  ComboboxViewport,
} from 'reka-ui'
import { computed, shallowRef, watch } from 'vue'
import { useOwnedOverlayLayerStyle } from '~/composables/useOverlayStack'
import { useToast } from '~/composables/useToast'
import {
  highlightMatch,
  lookupRecentStorageKey,
  recentStore,
} from '~/lib/kit/lookup'
import { toErrorMessage } from '~/lib/util/error'

interface Props {
  fetch: (keyword: string) => Promise<LookupOption[]>
  field?: string
  invalid?: boolean
  descriptionId?: string
  recentKey?: string
  allowCreate?: boolean
  disabledReason?: string
  placeholder?: string
}

const props = withDefaults(defineProps<Props>(), {
  field: undefined,
  invalid: false,
  descriptionId: undefined,
  recentKey: undefined,
  allowCreate: false,
  disabledReason: undefined,
  placeholder: '请选择',
})

const emit = defineEmits<{
  create: []
}>()

const model = defineModel<string | null>({ default: null })
const ownedLayerStyle = useOwnedOverlayLayerStyle()
const toast = useToast()
const open = shallowRef(false)
const query = shallowRef('')
const results = shallowRef<LookupOption[]>([])
const resultsKeyword = shallowRef<string>()
const selectedOption = shallowRef<LookupOption>()
const loading = shallowRef(false)

const recentState = props.recentKey
  ? useLocalStorage<LookupOption[]>(lookupRecentStorageKey(props.recentKey), [])
  : shallowRef<LookupOption[]>([])
const recents = recentStore(props.recentKey ?? 'disabled', recentState)

const recentIds = computed(() => new Set(recents.items.value.map(item => item.id)))
const visibleResults = computed(() =>
  resultsKeyword.value === query.value ? results.value : [],
)
const availableResults = computed(() =>
  visibleResults.value.filter(item => !recentIds.value.has(item.id)),
)

let queuedKeyword: string | undefined
let desiredKeyword = ''
let requestGeneration = 0
const inFlightRequests = new Map<string, Promise<void>>()

async function loadOptions(keyword: string, generation: number) {
  const existingRequest = inFlightRequests.get(keyword)
  if (existingRequest) {
    await existingRequest
    return
  }

  const request = props.fetch(keyword)
    .then((fetched) => {
      if (
        generation !== requestGeneration
        || desiredKeyword !== keyword
      ) {
        return
      }

      results.value = fetched
      resultsKeyword.value = keyword
    })
    .catch((error) => {
      if (
        generation !== requestGeneration
        || desiredKeyword !== keyword
      ) {
        return
      }

      results.value = []
      resultsKeyword.value = undefined
      toast.error('检索失败', toErrorMessage(error))
    })
    .finally(() => {
      if (inFlightRequests.get(keyword) === request)
        inFlightRequests.delete(keyword)
      if (
        generation === requestGeneration
        && desiredKeyword === keyword
      ) {
        loading.value = false
      }
    })

  inFlightRequests.set(keyword, request)
  await request
}

const fetchDebounced = useDebounceFn(async (
  keyword: string,
  generation: number,
) => {
  if (queuedKeyword === keyword)
    queuedKeyword = undefined
  if (
    generation !== requestGeneration
    || desiredKeyword !== keyword
  ) {
    return
  }
  if (resultsKeyword.value === keyword) {
    loading.value = false
    return
  }

  await loadOptions(keyword, generation)
}, 300)

function invalidateRequests() {
  requestGeneration += 1
  queuedKeyword = undefined
  desiredKeyword = ''
  inFlightRequests.clear()
  results.value = []
  resultsKeyword.value = undefined
  loading.value = false
}

function requestOptions(keyword: string, force = false) {
  if (force)
    invalidateRequests()

  desiredKeyword = keyword
  loading.value = resultsKeyword.value !== keyword

  if (keyword === queuedKeyword)
    return

  queuedKeyword = keyword
  void fetchDebounced(keyword, requestGeneration)
}

function invalidateLookupContext() {
  invalidateRequests()
  selectedOption.value = undefined
  query.value = ''
  if (props.recentKey)
    recents.clear()
}

function resolveOption(id: string | null | undefined) {
  if (!id)
    return undefined

  return [
    selectedOption.value,
    ...recents.items.value,
    ...results.value,
  ].find(option => option?.id === id)
}

function displayValue(value: unknown) {
  return typeof value === 'string'
    ? resolveOption(value)?.label ?? ''
    : ''
}

function handleOpenChange(nextOpen: boolean) {
  if (props.disabledReason) {
    open.value = false
    return
  }

  open.value = nextOpen
  if (nextOpen)
    requestOptions(query.value)
}

function handleFieldClick() {
  if (props.disabledReason)
    toast.warning(props.disabledReason)
}

function handleModelChange(value: unknown) {
  const id = typeof value === 'string' ? value : null
  const option = resolveOption(id)

  model.value = id
  selectedOption.value = option
  if (option) {
    recents.add(option)
    query.value = option.label
  }
}

function handleQueryChange(value: string | undefined) {
  query.value = value ?? ''
  if (open.value)
    requestOptions(query.value)
}

function clearSelection() {
  model.value = null
  selectedOption.value = undefined
  query.value = ''
  if (open.value)
    requestOptions('')
}

function clearRecents() {
  recents.clear()
}

watch(model, (id) => {
  if (!id) {
    selectedOption.value = undefined
    query.value = ''
    return
  }

  const option = resolveOption(id)
  selectedOption.value = option
  if (option) {
    query.value = option.label
    return
  }

  query.value = ''
  if (!props.disabledReason)
    requestOptions('', true)
}, { immediate: true })

watch(resultsKeyword, () => {
  if (!model.value || query.value)
    return

  const option = resolveOption(model.value)
  selectedOption.value = option
  if (option)
    query.value = option.label
})

watch(
  () => props.disabledReason,
  (reason) => {
    if (reason) {
      invalidateLookupContext()
      open.value = false
      return
    }

    if (model.value && !resolveOption(model.value))
      requestOptions('')
  },
)

watch(
  () => props.fetch,
  () => {
    invalidateLookupContext()
    if (!props.disabledReason && model.value)
      requestOptions('')
  },
)
</script>

<template>
  <ComboboxRoot
    :model-value="model"
    :open="open"
    :disabled="!!disabledReason"
    :open-on-focus="!disabledReason"
    :open-on-click="!disabledReason"
    :ignore-filter="true"
    :reset-search-term-on-blur="false"
    :reset-search-term-on-select="false"
    @update:model-value="handleModelChange"
    @update:open="handleOpenChange"
  >
    <ComboboxAnchor
      class="relative flex min-h-8 w-full items-center rounded-[var(--radius-btn)] border border-line bg-panel focus-within:border-brand focus-within:shadow-[0_0_0_3px_var(--brand-ring)]"
      :class="[
        disabledReason ? 'cursor-not-allowed bg-surface-2 opacity-70' : undefined,
        invalid ? 'border-danger! ring-1 ring-danger/20' : undefined,
      ]"
    >
      <ComboboxInput
        :model-value="query"
        :display-value="displayValue"
        :placeholder="placeholder"
        :disabled="!!disabledReason"
        :aria-disabled="disabledReason ? 'true' : undefined"
        :aria-describedby="descriptionId"
        :aria-invalid="invalid || undefined"
        :aria-label="placeholder"
        :data-field="field"
        class="min-w-0 flex-1 border-0 bg-transparent px-2.5 py-1.5 text-14px text-ink outline-none placeholder:text-ink-faint"
        @update:model-value="handleQueryChange"
      />

      <div class="flex shrink-0 items-center gap-0.5 pr-1">
        <button
          v-if="model && !disabledReason"
          type="button"
          class="icon-btn h-6 w-6 border-transparent bg-transparent"
          aria-label="清空选择"
          @mousedown.prevent
          @click.stop="clearSelection"
        >
          <span class="i-lucide-x h-3.5 w-3.5" aria-hidden="true" />
        </button>
        <button
          v-if="allowCreate && !disabledReason"
          type="button"
          class="icon-btn h-6 w-6 border-transparent bg-transparent text-brand"
          aria-label="新建选项"
          @mousedown.prevent
          @click.stop="emit('create')"
        >
          <span class="i-lucide-plus h-3.5 w-3.5" aria-hidden="true" />
        </button>
        <span
          class="i-lucide-chevrons-up-down mr-1 h-3.5 w-3.5 text-ink-faint"
          aria-hidden="true"
        />
      </div>
      <button
        v-if="disabledReason"
        type="button"
        class="absolute inset-0 z-10 cursor-not-allowed rounded-[var(--radius-btn)] border-0 bg-transparent"
        :aria-label="disabledReason"
        @click.stop="handleFieldClick"
      />
    </ComboboxAnchor>

    <ComboboxPortal>
      <ComboboxContent
        position="popper"
        align="start"
        :side-offset="5"
        data-overlay-owned
        class="overlay-layer-owned min-w-[var(--reka-combobox-trigger-width)] overflow-hidden rounded-[var(--radius-btn)] border border-line bg-panel shadow-[var(--shadow-pop)] data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=open]:fade-in-0 data-[state=closed]:fade-out-0 data-[state=open]:zoom-in-95 data-[state=closed]:zoom-out-95"
        :style="ownedLayerStyle"
      >
        <ComboboxViewport class="max-h-72 overflow-y-auto p-1">
          <ComboboxGroup v-if="recentKey && recents.items.value.length > 0">
            <div class="flex items-center justify-between px-2 py-1">
              <ComboboxLabel class="text-11px font-700 text-ink-faint">
                最近选择
              </ComboboxLabel>
              <button
                type="button"
                class="text-11px text-ink-faint hover:text-brand"
                @mousedown.prevent
                @click.stop="clearRecents"
              >
                不再显示
              </button>
            </div>
            <ComboboxItem
              v-for="option in recents.items.value"
              :key="`recent-${option.id}`"
              :value="option.id"
              :text-value="option.label"
              class="relative flex cursor-pointer select-none items-center rounded-[var(--radius-sm)] py-1.5 pl-7 pr-2 text-13px text-ink outline-none data-[highlighted]:bg-brand-soft data-[highlighted]:text-brand-deep"
            >
              <ComboboxItemIndicator class="absolute left-2 inline-flex items-center">
                <span class="i-lucide-check h-3.5 w-3.5 text-brand" aria-hidden="true" />
              </ComboboxItemIndicator>
              <span class="min-w-0">
                <span class="block truncate">{{ option.label }}</span>
                <span v-if="option.hint" class="block truncate text-11px text-ink-faint">
                  {{ option.hint }}
                </span>
              </span>
            </ComboboxItem>
          </ComboboxGroup>

          <ComboboxGroup>
            <ComboboxLabel class="block px-2 py-1 text-11px font-700 text-ink-faint">
              可选数据
            </ComboboxLabel>
            <p
              v-if="loading"
              class="px-2 py-2 text-12px text-ink-faint"
              role="status"
            >
              正在搜索…
            </p>
            <p
              v-else-if="availableResults.length === 0"
              class="px-2 py-2 text-12px text-ink-faint"
            >
              暂无可选数据
            </p>
            <ComboboxItem
              v-for="option in availableResults"
              :key="option.id"
              :value="option.id"
              :text-value="option.label"
              class="relative flex cursor-pointer select-none items-center rounded-[var(--radius-sm)] py-1.5 pl-7 pr-2 text-13px text-ink outline-none data-[highlighted]:bg-brand-soft data-[highlighted]:text-brand-deep"
            >
              <ComboboxItemIndicator class="absolute left-2 inline-flex items-center">
                <span class="i-lucide-check h-3.5 w-3.5 text-brand" aria-hidden="true" />
              </ComboboxItemIndicator>
              <span class="min-w-0">
                <span class="block truncate">
                  <template
                    v-for="(segment, index) in highlightMatch(option.label, query)"
                    :key="`${option.id}-${index}`"
                  >
                    <mark
                      v-if="segment.highlighted"
                      class="bg-transparent text-brand"
                    >{{ segment.text }}</mark>
                    <template v-else>
                      {{ segment.text }}
                    </template>
                  </template>
                </span>
                <span v-if="option.hint" class="block truncate text-11px text-ink-faint">
                  {{ option.hint }}
                </span>
              </span>
            </ComboboxItem>
          </ComboboxGroup>
        </ComboboxViewport>
      </ComboboxContent>
    </ComboboxPortal>
  </ComboboxRoot>
</template>
