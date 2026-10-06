<script setup lang="ts">
import KitButton from '~/components/ui/KitButton.vue'

defineProps<{ commandId: string, saved: boolean, busy: boolean }>()
defineEmits<{ recover: [] }>()
</script>

<template>
  <section class="panel grid min-w-0 gap-3 p-4" aria-label="原提交恢复" role="status">
    <p class="m-0 font-700">
      {{ saved ? '已保存待刷新' : '原提交结果未知' }}
    </p>
    <p class="m-0 break-words text-12px text-ink-soft">
      {{ saved ? '保留本页输入，重新读取同一记录确认保存。' : '保留本页输入，先核对原编号；确认原提交未应用后才能再次保存。' }}
      原提交编号：{{ commandId }}
    </p>
    <div>
      <KitButton type="button" :loading="busy" :disabled="busy" @click="$emit('recover')">
        {{ saved ? '重新读取已保存记录' : '核对原提交' }}
      </KitButton>
    </div>
  </section>
</template>
