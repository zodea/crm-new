<script setup lang="ts">
import { useTemplateRef } from 'vue'
import KitButton from '~/components/ui/KitButton.vue'

defineProps<{ pending: boolean, busy: boolean, error: string, awaitingRead?: boolean }>()
defineEmits<{ recover: [], refresh: [] }>()
const panel = useTemplateRef<HTMLElement>('panel')
defineExpose({ focus: () => panel.value?.focus() })
</script>

<template>
  <section v-if="pending || error" ref="panel" tabindex="-1" class="panel grid min-w-0 gap-2 p-3 text-12px leading-5" :role="error ? 'alert' : 'status'" aria-label="空鼓提交核对">
    <p v-if="error" class="break-words text-danger">
      {{ error }}
    </p><p class="break-words">
      {{ awaitingRead ? '提交已保存，正在核对原记录。原输入与编号仍保留。' : pending ? '上次提交结果尚未确认。请核对原提交，再继续修改。' : '原输入已保留，重新核对来源后再决定继续。' }}
    </p><div class="flex flex-wrap gap-2">
      <KitButton v-if="pending" type="button" :disabled="busy" @click="$emit('recover')">
        核对原提交
      </KitButton><KitButton type="button" variant="secondary" :disabled="busy" @click="$emit('refresh')">
        重新读取原户
      </KitButton>
    </div>
  </section>
</template>
