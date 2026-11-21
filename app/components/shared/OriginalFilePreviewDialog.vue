<script setup lang="ts">
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '~/components/ui/dialog'
import StatePanel from '~/components/ui/StatePanel.vue'

const {
  description = '只读预览，可关闭后下载原文件。',
  errorTitle = '附件暂不可预览',
  loadingTitle = '正在读取附件',
} = defineProps<{
  title: string
  description?: string
  url?: string
  mime: string
  busy: boolean
  problem: string
  errorTitle?: string
  loadingTitle?: string
  compact?: boolean
}>()

defineEmits<{
  closeAutoFocus: [event: Event]
}>()

const open = defineModel<boolean>('open', { required: true })
</script>

<template>
  <Dialog v-model:open="open">
    <DialogContent
      class="flex h-[85vh] w-[calc(100vw-2rem)] max-w-1100px flex-col overflow-hidden p-4"
      :class="{ 'gap-3': !compact }"
      @close-auto-focus="$emit('closeAutoFocus', $event)"
    >
      <DialogTitle :class="compact ? undefined : 'm-0 pr-8 text-16px font-700'">
        {{ title }}
      </DialogTitle>
      <DialogDescription :class="compact ? undefined : 'm-0 text-12px text-ink-faint'">
        {{ description }}
      </DialogDescription>
      <StatePanel v-if="problem" kind="error" :title="errorTitle" :description="problem" compact />
      <StatePanel v-else-if="busy" kind="loading" :title="loadingTitle" />
      <img v-else-if="url && mime.startsWith('image/')" :src="url" :alt="title" class="min-h-0 max-w-full flex-1 object-contain">
      <iframe v-else-if="url" :src="url" :title="title" class="min-h-0 w-full flex-1 border-0" />
    </DialogContent>
  </Dialog>
</template>
