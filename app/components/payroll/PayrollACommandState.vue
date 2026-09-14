<script setup lang="ts">
defineProps<{ pending: boolean, busy: boolean, error: string, awaitingRead?: boolean }>()
defineEmits<{ recover: [], refresh: [] }>()
</script>

<template>
  <section v-if="pending || error" class="panel grid gap-2 p-3 text-12px leading-5" :role="error ? 'alert' : 'status'" aria-label="工资提交核对">
    <p v-if="error" class="break-words text-danger">
      {{ error }}
    </p>
    <p>{{ awaitingRead ? '提交已保存，等待读取原结果。原输入与编号已保留，请核对原提交。' : pending ? '上次提交结果尚未确认，原输入已保留。请核对原提交，再继续修改。' : '当前输入已保留。核对来源后再决定继续，不能把缺失资料补成零。' }}</p>
    <div class="flex flex-wrap gap-2">
      <KitButton v-if="pending" type="button" :disabled="busy" @click="$emit('recover')">
        核对原提交
      </KitButton><KitButton type="button" variant="secondary" :disabled="busy" @click="$emit('refresh')">
        重新读取资料
      </KitButton>
    </div>
  </section>
</template>
