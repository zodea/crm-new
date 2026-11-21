<script setup lang="ts">
import type { PayrollARoundingRead, PayrollARoundingScope } from '~/lib/payroll/central-a-rounding-contract'
import type { DataOriginDTO } from '~/types/read-model'
import { computed, ref, shallowRef, watch } from 'vue'

const props = defineProps<{ scope: PayrollARoundingScope | null, origin: DataOriginDTO, blocked: boolean }>()
const emit = defineEmits<{ locked: [boolean] }>()
const store = usePayrollARoundingStore()
const read = shallowRef<PayrollARoundingRead | null>(null)
const selected = ref<'off' | 'floor'>('off')
const baseline = ref<'off' | 'floor'>('off')
const busy = ref(false)
const error = ref('')
const pending = computed(() => read.value ? store.getPending(read.value) : null)
const processing = computed(() => busy.value || !!pending.value)
const dirty = computed(() => !!read.value && selected.value !== baseline.value)
const locked = computed(() => processing.value || dirty.value)
const editable = computed(() => !!read.value && !props.blocked && !read.value.context.readonly && read.value.context.capabilities.includes('payroll:write'))

watch(locked, value => emit('locked', value), { immediate: true })

async function load() {
  read.value = null
  error.value = ''
  if (!props.scope)
    return
  busy.value = true
  try {
    read.value = await store.load({ origin: props.origin, projectId: props.scope.projectId, month: props.scope.month }, props.scope)
    selected.value = read.value.current?.rule.kind ?? 'off'
    baseline.value = selected.value
  }
  catch (cause) { error.value = cause instanceof Error ? cause.message : String(cause) }
  finally { busy.value = false }
}

async function save() {
  if (!read.value)
    return
  busy.value = true
  error.value = ''
  try {
    read.value = await store.save(read.value, selected.value === 'off' ? { kind: 'off' } : { kind: 'floor', stepFen: 10_000 })
    selected.value = read.value.current?.rule.kind ?? 'off'
    baseline.value = selected.value
  }
  catch (cause) { error.value = cause instanceof Error ? cause.message : String(cause) }
  finally { busy.value = false }
}

async function recover() {
  if (!read.value)
    return
  busy.value = true
  error.value = ''
  try {
    read.value = await store.recover(read.value)
    selected.value = read.value.current?.rule.kind ?? 'off'
    baseline.value = selected.value
  }
  catch (cause) { error.value = cause instanceof Error ? cause.message : String(cause) }
  finally { busy.value = false }
}

function discard() {
  selected.value = baseline.value
  error.value = ''
}

watch(() => [props.origin, props.scope] as const, load, { deep: true, immediate: true })
</script>

<template>
  <section id="section-rounding" class="panel mt-4 grid min-w-0 grid-cols-1 scroll-mt-4 gap-3 p-4" aria-label="A 工资发放取整">
    <SectionHeader title="发放取整" subtitle="每个负责人、请款簿和生效月份都必须明确选择；新修订不追改已发记录。" />
    <p v-if="!scope" class="text-12px text-ink-soft">
      请选择负责人和请款簿后配置。
    </p>
    <p v-else-if="busy && !read" role="status" class="text-12px">
      正在读取取整规则…
    </p>
    <template v-else-if="read">
      <p v-if="!read.current" class="rounded-md bg-warning/10 px-3 py-2 text-12px text-warning-strong">
        当前范围尚未明确取整规则，批量资金建议会阻断。
      </p>
      <label class="flex items-start gap-2 text-12px"><input v-model="selected" type="radio" value="off" :disabled="!editable || processing">不取整，按核算金额参与资金建议</label>
      <label class="flex items-start gap-2 text-12px"><input v-model="selected" type="radio" value="floor" :disabled="!editable || processing">向下取整到整百元（不足 100 元部分暂不发）</label>
      <p v-if="dirty" class="rounded-md bg-warning/10 px-3 py-2 text-12px text-warning-strong">
        取整规则尚未保存；保存或撤销后才能切换配置范围。
      </p>
      <p v-for="reason in read.readonlyReasons" :key="reason" class="text-12px text-warn">
        {{ reason }}
      </p>
      <div class="flex flex-wrap gap-2">
        <KitButton :disabled="!editable || processing || !dirty" @click="save">
          保存取整修订
        </KitButton>
        <KitButton v-if="dirty" variant="secondary" :disabled="processing" @click="discard">
          撤销未保存修改
        </KitButton>
        <KitButton v-if="pending" variant="secondary" :disabled="busy" @click="recover">
          按原编号核对提交
        </KitButton>
      </div>
      <p v-if="read.current" class="text-11px text-ink-faint">
        当前为第 {{ read.current.revision }} 版，生效月份 {{ read.current.effectiveMonth }}。
      </p>
    </template>
    <p v-if="error" role="alert" class="text-12px text-danger">
      {{ error }}
    </p>
  </section>
</template>
