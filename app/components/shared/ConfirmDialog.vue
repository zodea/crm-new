<script setup lang="ts">
import type { ConfirmImpact, ConfirmVariant, HoldState } from '~/lib/kit/confirm'
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import {
  beginHold,
  cancelHold,
  createHold,
  holdRemaining,
  isConfirmEnabled,
  tickHold,
} from '~/lib/kit/confirm'

// 三档确认弹窗（ADR 0003 + 规格 §01），底座换为 shadcn-vue Dialog（reka-ui）：
// 焦点陷阱 / Esc / 遮罩关闭 / aria-modal / 焦点返回 / 背景 inert 交给 reka，本组件只管
// 三档内容 + 打字门控 + 预提交挂起（纯逻辑复用 ~/lib/kit/confirm）。props/emits 对宿主保持不变。
// simple  高后果轻量操作 → 点确认即 emit('confirm')。
// batch   批量删除，显示「将删除 N 条」→ 点确认即 emit('confirm')，事后由调用方弹 undoToast。
// cascade 删有下游关联的父级 → 打记录名激活确认；点确认进 ≥3 秒预提交挂起（期间不写库、
//         显示显眼「撤销」），超时才 emit('confirm')，撤销则 emit('cancel')、不提交。
const props = withDefaults(defineProps<{
  open: boolean
  variant?: ConfirmVariant
  title?: string
  message: string
  count?: number
  impact?: ConfirmImpact[]
  requireTyping?: string
  holdMs?: number
  confirmLabel?: string
  cancelLabel?: string
}>(), {
  variant: 'simple',
  title: '确认操作',
  confirmLabel: '确定',
  cancelLabel: '取消',
})

const emit = defineEmits<{
  confirm: []
  cancel: []
}>()

const typed = ref('')
const hold = ref<HoldState | null>(null) // 非空 = cascade 挂起中
const remainingMs = ref(0)
let timer: ReturnType<typeof setInterval> | null = null

const cancelBtnRef = ref<HTMLButtonElement | null>(null)

const holding = computed(() => hold.value?.phase === 'pending')
const confirmEnabled = computed(() => isConfirmEnabled(props.requireTyping, typed.value))
const remainingSec = computed(() => Math.ceil(remainingMs.value / 1000))

function stopTimer() {
  if (timer) {
    clearInterval(timer)
    timer = null
  }
}

// 挂起轮询：用 confirm.ts 的纯状态机 + 真实时钟推进；到时 committed → 提交。
function startTimer() {
  stopTimer()
  timer = setInterval(() => {
    if (!hold.value) return
    hold.value = tickHold(hold.value, Date.now())
    remainingMs.value = holdRemaining(hold.value, Date.now())
    if (hold.value.phase === 'committed') {
      stopTimer()
      emit('confirm')
    }
  }, 100)
}

function onConfirm() {
  if (props.variant === 'cascade') {
    if (!confirmEnabled.value || holding.value) return
    hold.value = beginHold(createHold(props.holdMs), Date.now())
    remainingMs.value = hold.value.holdMs
    startTimer()
  }
  else {
    emit('confirm')
  }
}

// 撤销挂起 / Esc / 遮罩点击 / 取消：一律中止并回传 cancel（不提交）。
function onCancel() {
  if (hold.value) hold.value = cancelHold(hold.value)
  stopTimer()
  emit('cancel')
}

// reka 请求关闭（Esc / 点遮罩）→ 统一按取消处理（关闭都是安全路径）。
// 提交路径由宿主改 open=false 收起，不经此回调，故不会误触发 cancel。
function onOpenChange(value: boolean) {
  if (!value) onCancel()
}

// 危险操作焦点默认停在「取消」（安全选项，规格 §01）。
function onOpenAutoFocus(e: Event) {
  e.preventDefault()
  nextTick(() => cancelBtnRef.value?.focus())
}

watch(() => props.open, (open) => {
  if (open) {
    typed.value = ''
    hold.value = null
    remainingMs.value = 0
    stopTimer()
  }
  else {
    stopTimer()
  }
})

onBeforeUnmount(stopTimer)
</script>

<template>
  <Dialog :open="open" @update:open="onOpenChange">
    <DialogContent :show-close="false" @open-auto-focus="onOpenAutoFocus">
      <DialogTitle>{{ title }}</DialogTitle>

      <DialogDescription class="mt-3 leading-relaxed">
        {{ message }}
      </DialogDescription>

      <!-- batch：将删除 N 条 -->
      <p v-if="variant === 'batch' && count != null" class="text-13px text-ink mt-2">
        将删除 <b class="text-danger">{{ count }}</b> 条记录。
      </p>

      <!-- cascade：杀伤清单 -->
      <div
        v-if="variant === 'cascade' && impact?.length"
        class="mt-3 rounded-[var(--radius-btn)] bg-danger-soft border border-line px-3 py-2"
      >
        <div class="text-12px text-danger-ink font-700 mb-1.5">此操作将影响以下关联数据：</div>
        <ul class="flex flex-wrap gap-x-4 gap-y-1">
          <li v-for="it in impact" :key="it.label" class="text-12px text-ink-soft">
            {{ it.label }} <b class="text-danger-ink">×{{ it.n }}</b>
          </li>
        </ul>
      </div>

      <!-- cascade：type-to-confirm 输入框 -->
      <div v-if="variant === 'cascade' && requireTyping" class="mt-3">
        <label class="text-12px text-ink-soft">
          请输入 <b class="text-ink font-700">{{ requireTyping }}</b> 以确认删除：
        </label>
        <input
          v-model="typed"
          type="text"
          class="field-input w-full mt-1.5 rounded-[var(--radius-btn)]"
          :placeholder="requireTyping"
          :disabled="holding"
          autocomplete="off"
        >
      </div>

      <!-- footer -->
      <div class="flex justify-end gap-2 mt-5">
        <!-- 挂起中：显眼「撤销」（品牌蓝＝安全逃生口） -->
        <template v-if="holding">
          <button
            type="button"
            class="inline-flex items-center justify-center px-4 py-1.5 text-13px font-700 rounded-[var(--radius-btn)] border border-brand bg-brand text-white cursor-pointer transition-opacity hover:opacity-90"
            @click="onCancel"
          >
            撤销（{{ remainingSec }}s 内可停）
          </button>
          <span class="inline-flex items-center gap-1.5 px-3 text-13px text-danger-ink">
            <span class="i-lucide-loader-circle animate-spin text-14px" />
            删除中…
          </span>
        </template>
        <!-- 常态 footer：取消 ghost 左 · 确认 danger 右 -->
        <template v-else>
          <button
            ref="cancelBtnRef"
            type="button"
            class="inline-flex items-center justify-center px-4 py-1.5 text-13px font-600 rounded-[var(--radius-btn)] border border-transparent text-ink-soft cursor-pointer transition-colors hover:bg-surface-3 hover:text-ink"
            @click="onCancel"
          >
            {{ cancelLabel }}
          </button>
          <button
            type="button"
            class="inline-flex items-center justify-center px-4 py-1.5 text-13px font-600 rounded-[var(--radius-btn)] border border-danger bg-danger text-white cursor-pointer transition-opacity hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed"
            :disabled="variant === 'cascade' && !confirmEnabled"
            @click="onConfirm"
          >
            {{ confirmLabel }}
          </button>
        </template>
      </div>
    </DialogContent>
  </Dialog>
</template>
