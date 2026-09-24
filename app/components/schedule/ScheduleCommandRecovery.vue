<script setup lang="ts">
import { nextTick, onMounted, useTemplateRef } from 'vue'

defineProps<{ busy?: boolean }>()
const emit = defineEmits<{ recover: [], recheck: [] }>()
const recoverButton = useTemplateRef<HTMLButtonElement>('recoverButton')
onMounted(async () => {
  await nextTick()
  recoverButton.value?.focus()
})
</script>

<template>
  <section class="grid gap-2 rounded-lg border border-warning/40 bg-warning/8 p-3 text-12px" role="alert">
    <p>上次提交结果尚未确认，输入已保留。请核对原提交后继续修改。</p>
    <div class="flex flex-wrap gap-2">
      <button ref="recoverButton" type="button" class="btn-primary" :disabled="busy" @click="emit('recover')">
        核对原提交
      </button>
      <button type="button" class="btn-secondary" :disabled="busy" @click="emit('recheck')">
        重新核对权限与资料
      </button>
    </div>
  </section>
</template>
