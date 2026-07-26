<script setup lang="ts">
import type { NotificationKind, NotificationType } from '~/stores/notifications'
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
import { NOTIFICATION_TYPE_META } from '~/stores/notifications'

const props = defineProps<{
  open: boolean
}>()

const emit = defineEmits<{
  'update:open': [open: boolean]
}>()

const notificationStore = useNotificationStore()
const { items, unreadCount } = storeToRefs(notificationStore)
useModalLayerRegistration(toRef(props, 'open'))

const activeKind = shallowRef<NotificationKind>('todo')
const query = shallowRef('')
const selectedType = shallowRef<'all' | NotificationType>('all')

const kindItems = computed(() => items.value.filter(item => item.kind === activeKind.value))
const filteredItems = computed(() => {
  const keyword = query.value.trim().toLocaleLowerCase('zh-CN')
  return kindItems.value.filter((item) => {
    const matchesType = selectedType.value === 'all' || item.type === selectedType.value
    const matchesKeyword = !keyword
      || item.title.toLocaleLowerCase('zh-CN').includes(keyword)
      || item.description.toLocaleLowerCase('zh-CN').includes(keyword)
    return matchesType && matchesKeyword
  })
})

const typeOptions = computed(() => {
  const types = [...new Set(kindItems.value.map(item => item.type))]
  return [
    { key: 'all', label: '全部类型' },
    ...types.map(type => ({ key: type, label: NOTIFICATION_TYPE_META[type].label })),
  ]
})

const todoCount = computed(() => items.value.filter(item => item.kind === 'todo').length)
const noticeCount = computed(() => items.value.filter(item => item.kind === 'notice').length)

watch(activeKind, () => {
  selectedType.value = 'all'
})

async function openItem(id: string) {
  const route = notificationStore.openItem(id)
  if (!route)
    return
  emit('update:open', false)
  await navigateTo(route)
}
</script>

<template>
  <DialogRoot :open="props.open" @update:open="emit('update:open', $event)">
    <DialogPortal>
      <DialogOverlay
        data-overlay-backdrop
        class="fixed inset-0 z-[var(--z-overlay-backdrop)] bg-[var(--overlay)] data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=closed]:animate-out data-[state=closed]:fade-out-0"
      />
      <DialogContent
        data-overlay-surface
        class="fixed inset-y-0 right-0 z-[var(--z-overlay-surface)] flex h-svh w-[min(390px,100vw)] flex-col border-l border-line bg-panel text-ink shadow-[var(--shadow-pop)] outline-none data-[state=open]:animate-in data-[state=open]:slide-in-from-right data-[state=closed]:animate-out data-[state=closed]:slide-out-to-right"
      >
        <div class="flex h-[54px] shrink-0 items-center justify-between border-b border-line px-4">
          <div>
            <DialogTitle class="text-15px font-700">
              消息中心
            </DialogTitle>
            <DialogDescription class="mt-0.5 text-11px text-ink-soft">
              {{ unreadCount ? `${unreadCount} 条未读消息` : '消息均已读' }}
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
              <span class="font-mono text-10px tabular-nums">{{ todoCount }}</span>
            </TabsTrigger>
            <TabsTrigger
              value="notice"
              class="relative flex h-10 items-center gap-1.5 border-0 border-b-2 border-transparent bg-transparent px-1 text-13px font-600 text-ink-soft data-[state=active]:border-brand data-[state=active]:text-brand"
            >
              通知
              <span class="font-mono text-10px tabular-nums">{{ noticeCount }}</span>
            </TabsTrigger>
          </TabsList>

          <div class="grid shrink-0 grid-cols-[116px_minmax(0,1fr)] gap-2 border-b border-line p-3">
            <SelectFilter v-model="selectedType" :options="typeOptions" :min-width="116" />
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
                    <span class="mt-1.5 flex items-center gap-2 text-10px text-ink-faint">
                      <span>{{ NOTIFICATION_TYPE_META[item.type].label }}</span>
                      <span aria-hidden="true">·</span>
                      <span>{{ item.time }}</span>
                    </span>
                  </span>
                </button>

                <button
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
                  {{ query || selectedType !== 'all' ? '没有匹配的消息' : activeKind === 'todo' ? '暂无待办' : '暂无通知' }}
                </p>
              </div>
            </div>
          </TabsContent>
        </TabsRoot>

        <div class="shrink-0 border-t border-line p-3">
          <button
            type="button"
            class="h-9 w-full border border-brand rounded-[var(--radius-btn)] bg-panel text-12px font-600 text-brand transition-colors duration-[var(--dur-fast)] hover:bg-brand-soft disabled:cursor-not-allowed disabled:border-line disabled:text-ink-faint disabled:hover:bg-panel"
            :disabled="unreadCount === 0"
            @click="notificationStore.markAllRead"
          >
            全部标记为已读
          </button>
        </div>
      </DialogContent>
    </DialogPortal>
  </DialogRoot>
</template>
