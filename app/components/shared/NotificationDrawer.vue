<script setup lang="ts">
defineProps<{
  open: boolean
}>()

const emit = defineEmits<{
  close: []
}>()

interface Notification {
  id: string
  type: 'payment' | 'payroll' | 'invoice' | 'delivery' | 'cert'
  title: string
  desc: string
  time: string
  route: string
}

const TYPE_ICON: Record<string, string> = {
  payment: 'i-lucide-banknote',
  payroll: 'i-lucide-wallet',
  invoice: 'i-lucide-receipt',
  delivery: 'i-lucide-truck',
  cert: 'i-lucide-shield-alert',
}
const TYPE_COLOR: Record<string, string> = {
  payment: 'text-brand',
  payroll: 'text-warn',
  invoice: 'text-ok',
  delivery: 'text-brand',
  cert: 'text-danger',
}
const TYPE_LABEL: Record<string, string> = {
  payment: '付款审批',
  payroll: '工资发放',
  invoice: '发票校对',
  delivery: '送货入库',
  cert: '证书过期',
}

const notifications: Notification[] = [
  { id: 'n1', type: 'invoice', title: '2 张发票待校对', desc: '大板东建材 · 合和新城', time: '10 分钟前', route: '/finance/invoice' },
  { id: 'n2', type: 'delivery', title: '3 张送货单待识别', desc: '合和新城·3号楼', time: '30 分钟前', route: '/material/delivery' },
  { id: 'n3', type: 'cert', title: '顺利圆铝业 营业执照即将过期', desc: '30 天内到期', time: '1 小时前', route: '/base/supplier' },
  { id: 'n4', type: 'payment', title: '付款申请待审批', desc: '鸿运五金 · ¥8,755.00', time: '2 小时前', route: '/finance/invoice' },
]
</script>

<template>
  <Teleport to="body">
    <Transition
      enter-active-class="transition-opacity duration-[200ms]"
      leave-active-class="transition-opacity duration-[150ms]"
      enter-from-class="opacity-0"
      leave-to-class="opacity-0"
    >
      <div v-if="open" class="fixed inset-0 z-[8000]">
        <div class="absolute inset-0 bg-black/20" @click="emit('close')" />
        <div
          class="absolute right-0 top-0 h-full w-[340px] bg-panel border-l border-line shadow-[var(--shadow-pop)] flex flex-col"
          style="animation: slide-right-in 200ms var(--ease-snappy)"
        >
          <div class="flex items-center justify-between px-4 py-3 border-b border-line shrink-0">
            <h3 class="text-14px font-800 text-ink">通知</h3>
            <button class="icon-btn" @click="emit('close')">
              <span class="i-lucide-x text-14px" />
            </button>
          </div>

          <div class="flex-1 overflow-y-auto">
            <div
              v-for="n in notifications"
              :key="n.id"
              class="flex gap-3 px-4 py-3 border-b border-line hover:bg-surface-3 cursor-pointer transition-colors"
              @click="emit('close'); navigateTo(n.route)"
            >
              <span :class="[TYPE_ICON[n.type], TYPE_COLOR[n.type]]" class="text-18px shrink-0 mt-0.5" />
              <div class="flex-1 min-w-0">
                <div class="text-13px font-600 text-ink mb-0.5">{{ n.title }}</div>
                <div class="text-11px text-ink-soft">{{ n.desc }}</div>
                <div class="text-10px text-ink-faint mt-1 flex items-center gap-1">
                  <span class="chip text-9px" :class="`bg-surface-3 text-ink-soft`">{{ TYPE_LABEL[n.type] }}</span>
                  · {{ n.time }}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
@keyframes slide-right-in {
  from { transform: translateX(100%); }
  to { transform: translateX(0); }
}
</style>
