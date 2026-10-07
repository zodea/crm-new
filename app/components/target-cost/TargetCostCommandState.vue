<script setup lang="ts">
withDefaults(defineProps<{ error: string, pending: boolean, busy: boolean, applied?: boolean }>(), { applied: false })
defineEmits<{ recover: [], recheck: [] }>()
</script>

<template>
  <section v-if="pending" class="panel grid gap-2 p-4 text-12px" role="status" aria-label="目标成本原提交待核对">
    <p>{{ applied ? '预算已经保存，授权读取尚未完成。请只重试读取，不重新发送。' : '上次提交结果尚未确认，请先按原编号核对。' }}正文与附件在当前页面保留，刷新后只保留原编号。</p>
    <div class="flex flex-wrap gap-2">
      <KitButton type="button" variant="primary" :disabled="busy" @click="$emit('recover')">
        {{ applied ? '只重试读取' : '核对原提交' }}
      </KitButton>
      <KitButton type="button" variant="secondary" :disabled="busy" @click="$emit('recheck')">
        重新核对权限与资料
      </KitButton>
    </div>
  </section>
  <section v-if="error" class="panel grid min-w-0 gap-2 border-danger/30 bg-danger-soft p-4 text-12px text-danger-ink" role="alert">
    <p class="break-words">
      {{ error }}
    </p>
    <p>未保存输入仍保留；重新读取不会自动替换这份草稿的保存依据。</p>
    <KitButton type="button" variant="secondary" class="justify-self-start" :disabled="busy" @click="$emit('recheck')">
      重新核对资料
    </KitButton>
  </section>
</template>
