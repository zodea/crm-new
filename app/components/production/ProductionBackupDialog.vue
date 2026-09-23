<script setup lang="ts">
import type { DeepReadonly } from 'vue'
import type { ProductionBackupAction, ProductionBackupCommand, ProductionBackupRun, ProductionBackupStatus } from '~/lib/production/backup-contract'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '~/components/ui/dialog'
import { backupActionLabels, backupProtectionLabels, backupTime } from '~/lib/production/backup-presentation'

defineProps<{
  status: DeepReadonly<ProductionBackupStatus> | null
  busy: boolean
  problem: string
  pending: DeepReadonly<ProductionBackupCommand> | null
  result: DeepReadonly<ProductionBackupRun> | null
}>()
const emit = defineEmits<{ action: [ProductionBackupAction], retry: [], refresh: [], returnFocus: [] }>()
const open = defineModel<boolean>('open', { required: true })
</script>

<template>
  <Dialog v-model:open="open">
    <DialogContent class="flex max-h-[90dvh] flex-col gap-3 p-4 sm:p-5" style="width: min(640px, calc(100dvw - 24px))" aria-describedby="backup-description" @close-auto-focus.prevent="emit('returnFocus')">
      <DialogTitle class="pr-7 text-16px">
        备份与恢复
      </DialogTitle>
      <DialogDescription id="backup-description">
        将已保存资料和原件一起备份。恢复验证只写入独立位置，不替换正在使用的资料。
      </DialogDescription>
      <div class="grid min-h-0 gap-4 overflow-y-auto text-12px leading-5" style="max-height: min(65dvh, 560px)">
        <section class="grid gap-2 rounded border border-line bg-surface-2 p-3" aria-label="资料保护状态">
          <strong>{{ status ? backupProtectionLabels[status.protection] : '正在核对备份状态' }}</strong>
          <p>主备份资料时点：{{ backupTime(status?.latest?.capturedAt) }}</p>
          <p>离线副本资料时点：{{ backupTime(status?.offline?.capturedAt) }}</p>
          <p>隔离恢复验证：{{ backupTime(status?.baseline?.restoredAt) }}</p>
          <p v-if="status?.baseline && !status.baseline.current" class="text-danger">
            该恢复验证属于旧版本，请重新备份并验证当前版本。
          </p>
          <p class="text-ink-muted">
            计划每 {{ status?.intervalHours ?? 12 }} 小时备份；电脑唤醒或服务重启后会补跑。正式写入仍需上线验收。
          </p>
          <p v-if="status && !status.configured" class="text-danger">
            请维护人配置主备份、离线副本与隔离恢复位置，再执行验证。
          </p>
        </section>
        <p v-if="problem" role="alert" class="break-words text-danger">
          {{ problem }}
        </p>
        <p v-if="result" role="status" class="break-words" :class="result.state === 'failed' ? 'text-danger' : 'text-brand'">
          {{ backupActionLabels[result.action] }}{{ result.state === 'succeeded' ? '已完成' : result.state === 'failed' ? '未完成' : '正在进行' }}{{ result.message ? `：${result.message}` : '' }}
        </p>
        <p v-if="pending" role="status">
          上次操作仍待确认。请用“核对原操作”继续，不会另外建立重复操作。
        </p>
        <div class="flex flex-wrap gap-2">
          <button v-if="pending" type="button" class="btn-accent" :disabled="busy" @click="emit('retry')">
            {{ busy ? '正在核对…' : '核对原操作' }}
          </button>
          <template v-else>
            <button type="button" class="btn-accent" :disabled="busy || !status?.configured || status.running || !!problem" @click="emit('action', 'backup')">
              {{ busy ? '正在处理…' : '立即备份' }}
            </button>
            <button type="button" class="btn-secondary" :disabled="busy || !status?.latest || status.running || !!problem" @click="emit('action', 'copy-offline')">
              复制到离线介质
            </button>
            <button type="button" class="btn-secondary" :disabled="busy || !status?.latest || status.running || !!problem" @click="emit('action', 'verify-restore')">
              验证隔离恢复
            </button>
          </template>
          <button type="button" class="btn-ghost" :disabled="busy" @click="emit('refresh')">
            刷新状态
          </button>
        </div>
        <section v-if="status?.recent.length" class="grid gap-2" aria-label="最近备份操作">
          <h3 class="font-700">
            最近操作
          </h3>
          <ul class="grid gap-2">
            <li v-for="run in status.recent" :key="run.commandId" class="border-t border-line pt-2">
              <p>{{ backupActionLabels[run.action] }} · {{ run.state === 'succeeded' ? '已完成' : run.state === 'failed' ? '未完成' : '进行中' }} · {{ backupTime(run.completedAt ?? run.startedAt) }}</p>
              <p v-if="run.message" class="mt-1 break-words text-ink-muted">
                {{ run.message }}
              </p>
            </li>
          </ul>
        </section>
      </div>
    </DialogContent>
  </Dialog>
</template>
