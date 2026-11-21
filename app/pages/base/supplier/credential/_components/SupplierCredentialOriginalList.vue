<script setup lang="ts">
import type { SupplierCredentialRecord } from '~/lib/supplier/credential-contract'
import { computed } from 'vue'
import { credentialExpiryState } from '~/lib/supplier/credentials'
import { formatShanghaiDateTime } from '~/lib/util/datetime'

const props = defineProps<{ credentials: readonly SupplierCredentialRecord[], canWrite: boolean, businessDate: string, busy: boolean }>()
defineEmits<{ upload: [], edit: [record: SupplierCredentialRecord], remove: [record: SupplierCredentialRecord], preview: [record: SupplierCredentialRecord], download: [record: SupplierCredentialRecord], recognize: [record: SupplierCredentialRecord], reviewOcr: [record: SupplierCredentialRecord] }>()
const rows = computed(() => props.credentials.map((record) => {
  const expiry = record.validity?.state ?? credentialExpiryState(record, new Date(`${props.businessDate}T12:00:00+08:00`))
  return {
    record,
    expiryLabel: record.longTerm ? '长期有效' : expiry === 'expired' ? `已过期 · ${record.expiresAt}` : expiry === 'unrecorded' ? (record.expiresAt.trim() ? '日期无效 · 待核对' : '有效期未录入') : `${expiry === 'expiring' ? '即将到期' : '有效至'} · ${record.expiresAt}`,
    expiryClass: expiry === 'expired' ? 'chip-danger' : expiry === 'expiring' || expiry === 'unrecorded' ? 'chip-warn' : 'chip-ok',
  }
}))
</script>

<template>
  <section class="panel min-w-0 overflow-hidden" aria-labelledby="central-credential-list-title">
    <div class="flex flex-wrap items-center gap-3 border-b border-line p-4">
      <div class="mr-auto min-w-0">
        <h3 id="central-credential-list-title" class="m-0 text-14px font-700 text-ink">
          证照原件 · {{ credentials.length }} 份
        </h3>
        <p class="mb-0 mt-1 text-12px leading-5 text-ink-soft">
          支持 PDF、PNG、JPG/JPEG，每份不超过 20 MB。上传后可人工维护和核验。
        </p>
      </div>
      <button v-if="canWrite" type="button" class="btn-accent" :disabled="busy" @click="$emit('upload')">
        <span class="i-lucide-upload mr-1" aria-hidden="true" />上传原件
      </button>
    </div>
    <div class="max-w-full overflow-x-auto" tabindex="0" aria-label="证照原件表，可横向滚动">
      <table class="w-full min-w-[58rem] border-collapse text-left text-12px">
        <thead>
          <tr class="border-b border-line bg-surface-2 text-ink-soft">
            <th class="px-3 py-2">
              证照类别
            </th><th class="px-3 py-2">
              原件
            </th><th class="px-3 py-2">
              有效期
            </th><th class="px-3 py-2">
              识别记录
            </th><th class="px-3 py-2">
              添加时间
            </th><th class="px-3 py-2 text-right">
              操作
            </th>
          </tr>
        </thead>
        <tbody>
          <tr v-if="!credentials.length">
            <td colspan="6" class="px-3 py-10 text-center text-ink-faint">
              尚未添加证照原件
            </td>
          </tr>
          <tr v-for="{ record, expiryLabel, expiryClass } in rows" :key="record.id" class="border-b border-line">
            <td class="px-3 py-3">
              <span class="chip chip-brand">{{ record.category }}</span>
            </td>
            <td class="max-w-64 px-3 py-3">
              <button v-if="record.file?.state === 'available'" type="button" class="block max-w-full cursor-pointer truncate border-0 bg-transparent p-0 text-left text-brand hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand" :title="record.file.fileName" @click="$emit('preview', record)">
                {{ record.file.fileName }}
              </button>
              <span v-else class="block break-words text-warn-ink">{{ record.file?.fileName || '历史原件' }} · 缺少正文，请重新上传</span>
            </td>
            <td class="px-3 py-3">
              <span class="chip" :class="expiryClass">{{ expiryLabel }}</span>
            </td>
            <td class="px-3 py-3 text-ink-soft">
              <span>{{ record.ocrReviewStatus === 'confirmed' ? '已核对' : record.ocrReviewStatus === 'pending' ? '待核对' : '未识别' }}</span>
              <button v-if="record.ocrReviewStatus !== 'not_started' || Object.keys(record.ocrResult).length" type="button" class="ml-2 cursor-pointer border-0 bg-transparent p-0 text-brand hover:underline focus-visible:outline-2 focus-visible:outline-brand" :disabled="busy" :aria-label="`核对识别结果 ${record.file?.fileName || record.category}`" @click="$emit('reviewOcr', record)">
                {{ record.ocrReviewStatus === 'pending' ? '继续核对' : '查看记录' }}
              </button>
            </td>
            <td class="px-3 py-3 text-11px text-ink-soft">
              {{ formatShanghaiDateTime(record.addedAt, '历史时间未知') }}
            </td>
            <td class="px-3 py-3">
              <div class="flex justify-end gap-1">
                <button v-if="canWrite" type="button" class="icon-btn" :disabled="busy || record.file?.state !== 'available'" :aria-label="`识别当前原件 ${record.file?.fileName || record.category}`" title="识别当前原件" @click="$emit('recognize', record)">
                  <span class="i-lucide-scan-text" aria-hidden="true" />
                </button>
                <button v-if="canWrite" type="button" class="icon-btn" :disabled="busy" :aria-label="`编辑类别和有效期 ${record.file?.fileName || record.category}`" title="编辑类别和有效期" @click="$emit('edit', record)">
                  <span class="i-lucide-pencil" aria-hidden="true" />
                </button>
                <button type="button" class="icon-btn" :disabled="busy || record.file?.state !== 'available'" :aria-label="`预览 ${record.file?.fileName || record.category}`" title="预览原件" @click="$emit('preview', record)">
                  <span class="i-lucide-eye" aria-hidden="true" />
                </button>
                <button type="button" class="icon-btn" :disabled="busy || record.file?.state !== 'available'" :aria-label="`下载 ${record.file?.fileName || record.category}`" title="下载原件" @click="$emit('download', record)">
                  <span class="i-lucide-download" aria-hidden="true" />
                </button>
                <button v-if="canWrite" type="button" class="icon-btn-danger" :disabled="busy" :aria-label="`删除 ${record.file?.fileName || record.category}`" title="删除证照" @click="$emit('remove', record)">
                  <span class="i-lucide-trash-2" aria-hidden="true" />
                </button>
              </div>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </section>
</template>
