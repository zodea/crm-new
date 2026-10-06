<script setup lang="ts">
import type { NotificationKind } from '~/stores/notifications'
import { useMediaQuery } from '@vueuse/core'
import { storeToRefs } from 'pinia'
import {
  DialogContent,
  DialogDescription,
  DialogOverlay,
  DialogPortal,
  DialogRoot,
  DialogTitle,
  TabsContent,
  TabsList,
  TabsRoot,
  TabsTrigger,
} from 'reka-ui'
import KitMultiSelectFilter from '~/components/ui/KitMultiSelectFilter.vue'
import { useModalLayerRegistration } from '~/composables/useOverlayStack'
import { readProblemTitle, readStateProblem } from '~/lib/read-model/state'
import { NOTIFICATION_TYPE_META } from '~/stores/notifications'

const props = defineProps<{
  open: boolean
}>()

const emit = defineEmits<{
  'update:open': [open: boolean]
}>()

const notificationStore = useNotificationStore()
const { items, unreadCount, loading, error, pending, evaluationUnavailable, readState } = storeToRefs(notificationStore)
const readingProblem = computed(() => readStateProblem(readState.value))
const dataVisibilityStore = useDataVisibilityStore()
const { layerStyle } = useModalLayerRegistration(toRef(props, 'open'))
const isCompact = useMediaQuery('(max-width: 768px)', { ssrWidth: 1024 })
const sheetPlacement = computed(() => isCompact.value ? 'bottom' : 'right')

const activeKind = shallowRef<NotificationKind>('todo')
const query = shallowRef('')
const selectedType = shallowRef<string[]>([])

const kindItems = computed(() => items.value.filter(item => item.kind === activeKind.value))
const filteredItems = computed(() => {
  const keyword = query.value.trim().toLocaleLowerCase('zh-CN')
  return kindItems.value.filter((item) => {
    const matchesType = !selectedType.value.length || selectedType.value.includes(item.type)
    const matchesKeyword = !keyword
      || item.title.toLocaleLowerCase('zh-CN').includes(keyword)
      || item.description.toLocaleLowerCase('zh-CN').includes(keyword)
    return matchesType && matchesKeyword
  })
})

const typeOptions = Object.entries(NOTIFICATION_TYPE_META).map(([key, meta]) => ({ key, label: meta.label }))

const todoCount = computed(() => items.value.filter(item => item.kind === 'todo').length)
const noticeCount = computed(() => items.value.filter(item => item.kind === 'notice').length)

watch(activeKind, () => {
  selectedType.value = []
})

async function openItem(id: string) {
  const route = await notificationStore.openItem(id)
  if (!route)
    return
  emit('update:open', false)
  await navigateTo(route)
}

async function recoverPending() {
  const route = await notificationStore.recoverPending()
  if (route) {
    emit('update:open', false)
    await navigateTo(route)
  }
}
</script>

<template>
  <DialogRoot :open="props.open" @update:open="emit('update:open', $event)">
    <DialogPortal>
      <DialogOverlay
        data-overlay-backdrop
        class="overlay-layer-backdrop fixed inset-0 bg-[var(--overlay)] data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=closed]:animate-out data-[state=closed]:fade-out-0"
        :style="layerStyle"
      />
      <DialogContent
        data-overlay-surface
        :data-sheet-placement="sheetPlacement"
        class="notification-sheet overlay-layer-surface fixed flex flex-col bg-panel text-ink shadow-[var(--shadow-pop)] outline-none data-[state=open]:animate-in data-[state=closed]:animate-out"
        :class="isCompact
          ? 'notification-sheet--bottom inset-x-0 bottom-0 w-screen border-t border-line rounded-t-[var(--radius-card)] data-[state=open]:slide-in-from-bottom data-[state=closed]:slide-out-to-bottom'
          : 'inset-y-0 right-0 h-svh w-[min(390px,100vw)] border-l border-line data-[state=open]:slide-in-from-right data-[state=closed]:slide-out-to-right'"
        :style="layerStyle"
      >
        <div
          v-if="isCompact"
          data-sheet-handle
          class="mx-auto mt-2 h-1 w-9 shrink-0 rounded-full bg-line-strong"
          aria-hidden="true"
        />
        <div class="flex h-[54px] shrink-0 items-center justify-between border-b border-line px-4">
          <div>
            <DialogTitle class="text-15px font-700">
              消息中心
            </DialogTitle>
            <DialogDescription data-notification-count class="mt-0.5 text-11px text-ink-soft">
              {{ error || evaluationUnavailable ? '未读状态待核对' : loading ? '正在核对消息' : unreadCount ? `${unreadCount} 条未读消息` : '消息均已读' }}
            </DialogDescription>
          </div>
          <button
            type="button"
            class="shell-icon-button"
            title="关闭消息中心"
            aria-label="关闭消息中心"
            @click="emit('update:open', false)"
          >
            <span class="i-lucide-x h-4 w-4" aria-hidden="true" />
          </button>
        </div>

        <TabsRoot v-model="activeKind" class="min-h-0 flex flex-1 flex-col">
          <TabsList class="flex h-11 shrink-0 items-end gap-6 border-b border-line px-4">
            <TabsTrigger
              value="todo"
              class="relative flex h-10 items-center gap-1.5 border-0 border-b-2 border-transparent bg-transparent px-1 text-13px font-600 text-ink-soft data-[state=active]:border-brand data-[state=active]:text-brand"
            >
              待办
              <span data-notification-count class="font-mono text-10px tabular-nums">{{ todoCount }}</span>
            </TabsTrigger>
            <TabsTrigger
              value="notice"
              class="relative flex h-10 items-center gap-1.5 border-0 border-b-2 border-transparent bg-transparent px-1 text-13px font-600 text-ink-soft data-[state=active]:border-brand data-[state=active]:text-brand"
            >
              通知
              <span data-notification-count class="font-mono text-10px tabular-nums">{{ noticeCount }}</span>
            </TabsTrigger>
          </TabsList>

          <div class="flex shrink-0 flex-wrap gap-2 border-b border-line p-3">
            <KitMultiSelectFilter v-model="selectedType" label="类型" aria-label="消息类型" :options="typeOptions" :min-width="100" />
            <label class="flex h-[34px] min-w-0 items-center gap-2 border border-line-strong rounded-[var(--radius-btn)] bg-panel px-2.5 focus-within:border-brand">
              <span class="i-lucide-search h-3.5 w-3.5 flex-none text-ink-faint" aria-hidden="true" />
              <input
                v-model="query"
                type="search"
                class="min-w-0 flex-1 border-0 bg-transparent text-12px outline-none placeholder:text-ink-faint"
                placeholder="搜索消息"
                autocomplete="off"
              >
            </label>
          </div>

          <TabsContent :value="activeKind" class="min-h-0 flex-1 overflow-y-auto outline-none">
            <div v-if="error || evaluationUnavailable" role="status" class="border-b border-line p-3 text-12px leading-5 text-warn">
              {{ readProblemTitle(readingProblem, error || '持续提醒来源暂未就绪；资料当前有效性仍以资料页为准。') }}
              <button type="button" class="ml-2 border-0 bg-transparent text-brand underline" @click="notificationStore.refresh()">
                重试读取
              </button>
            </div>
            <div v-if="pending" role="status" class="border-b border-line p-3 text-12px leading-5 text-warn">
              上次已读操作尚待核对；当前已读显示不会代替原提交回执。
              <button type="button" class="ml-2 border-0 bg-transparent text-brand underline" @click="recoverPending">
                恢复原已读操作
              </button>
            </div>
            <p v-if="loading" role="status" class="px-4 text-12px text-ink-soft">
              正在核对消息…
            </p>
            <div v-if="filteredItems.length" class="divide-y divide-line">
              <article
                v-for="item in filteredItems"
                :key="item.id"
                class="group relative flex gap-3 px-4 py-3 transition-colors duration-[var(--dur-fast)] hover:bg-surface-3"
                :class="item.read ? 'bg-panel' : 'bg-[rgb(213_230_248/28%)]'"
              >
                <button
                  type="button"
                  class="flex min-w-0 flex-1 gap-3 border-0 bg-transparent text-left"
                  @click="openItem(item.id)"
                >
                  <span
                    class="mt-0.5 h-[18px] w-[18px] flex-none"
                    :class="[NOTIFICATION_TYPE_META[item.type].icon, NOTIFICATION_TYPE_META[item.type].color]"
                    aria-hidden="true"
                  />
                  <span class="min-w-0 flex-1">
                    <span class="flex items-start gap-2">
                      <span class="min-w-0 flex-1 text-13px font-600 text-ink">{{ item.title }}</span>
                      <span v-if="!item.read" class="mt-1.5 h-1.5 w-1.5 flex-none rounded-full bg-brand" aria-label="未读" />
                    </span>
                    <span class="mt-1 block text-11px leading-relaxed text-ink-soft">{{ item.description }}</span>
                    <span v-if="item.problem" class="mt-1 block text-11px leading-relaxed" :class="item.problem.state === 'active' ? 'text-warn' : 'text-ok'">
                      {{ item.problem.state === 'resolved' ? '问题已解除，历史提醒保留' : item.problem.severity === 'expired' ? '持续问题 · 已过期' : '持续问题 · 7 天内到期' }}
                      <span v-if="item.problem.state === 'active' && item.read"> · 已读仍需处理</span>
                    </span>
                    <span class="mt-1.5 flex items-center gap-2 text-10px text-ink-faint">
                      <span>{{ NOTIFICATION_TYPE_META[item.type].label }}</span>
                      <span aria-hidden="true">·</span>
                      <span>{{ item.time }}</span>
                    </span>
                  </span>
                </button>

                <button
                  v-if="dataVisibilityStore.includeDemo"
                  type="button"
                  class="absolute bottom-2 right-2 grid h-7 w-7 place-items-center border-0 rounded-[var(--radius-btn)] bg-transparent text-ink-faint opacity-0 transition-opacity duration-[var(--dur-fast)] hover:bg-danger-soft hover:text-danger group-hover:opacity-100 focus-visible:opacity-100"
                  title="删除消息"
                  aria-label="删除消息"
                  @click="notificationStore.remove(item.id)"
                >
                  <span class="i-lucide-trash-2 h-3.5 w-3.5" aria-hidden="true" />
                </button>
              </article>
            </div>

            <div v-else class="grid min-h-[260px] place-items-center px-6 text-center">
              <div>
                <span class="i-lucide-inbox mx-auto h-9 w-9 text-ink-faint" aria-hidden="true" />
                <p class="mt-3 text-13px font-600 text-ink-soft">
                  {{ error ? '消息读取失败' : loading ? '正在核对消息' : query || selectedType.length ? '没有匹配的消息' : activeKind === 'todo' ? '暂无待办' : '暂无通知' }}
                </p>
              </div>
            </div>
          </TabsContent>
        </TabsRoot>

        <div class="shrink-0 border-t border-line p-3">
          <button
            type="button"
            class="h-9 w-full border border-brand rounded-[var(--radius-btn)] bg-panel text-12px font-600 text-brand transition-colors duration-[var(--dur-fast)] hover:bg-brand-soft disabled:cursor-not-allowed disabled:border-line disabled:text-ink-faint disabled:hover:bg-panel"
            :disabled="unreadCount === 0 || loading || Boolean(error) || evaluationUnavailable || Boolean(pending)"
            @click="notificationStore.markAllRead"
          >
            全部标记为已读
          </button>
        </div>
      </DialogContent>
    </DialogPortal>
  </DialogRoot>
</template>

<style scoped>
.notification-sheet--bottom {
  height: min(82svh, 680px);
}
</style>
