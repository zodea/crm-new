<script setup lang="ts">
import type { Invoice } from '~/stores/invoice'

// 原文件不在本次上传会话中（刷新后、撤回窗口结束后、导入/手工录入的记录）时的如实说明：
// 不用示意图冒充原件（工作台中栏与编辑页左栏共用）。
defineProps<{
  invoice: Pick<Invoice, 'fileName' | 'source'>
}>()
</script>

<template>
  <div class="flex flex-col items-center gap-2 px-4 py-10 text-center" data-testid="invoice-original-missing" role="status">
    <span class="i-lucide-file-question text-28px text-ink-faint" aria-hidden="true" />
    <p class="text-13px font-700 text-ink">
      原件不在本次会话中
    </p>
    <p class="max-w-[28rem] text-12px text-ink-soft">
      <template v-if="invoice.source === 'excel'">
        该记录来自台账导入或手工录入，没有随会话保留的原文件。
      </template>
      <template v-else>
        原文件<template v-if="invoice.fileName">
          「{{ invoice.fileName }}」
        </template>只在上传它的会话中保留，刷新应用或删除、归档后撤回窗口结束即释放；查看原件或继续识别需要重新上传。
      </template>
    </p>
  </div>
</template>
