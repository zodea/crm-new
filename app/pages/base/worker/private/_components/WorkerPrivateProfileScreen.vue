<script setup lang="ts">
import type { WorkerPhotoPurpose } from '~/lib/worker-roster/contract'
import { useWorkerPrivateProfile } from '~/composables/useWorkerPrivateProfile'

const route = useRoute()
const ui = useWorkerPrivateProfile(() => String(route.params.id ?? ''))
const { current, values, uploads, error, busy, writable, dirty, pending } = ui
const photos: { purpose: WorkerPhotoPurpose, field: 'portraitId' | 'bankCardId', label: string }[] = [{ purpose: 'portrait', field: 'portraitId', label: '证件照' }, { purpose: 'bank-card', field: 'bankCardId', label: '银行卡照' }]
useTabTitle(() => `${current.value?.worker.name ?? '工人'} · 私密资料`)
</script>

<template>
  <EntityFormShell title="工人私密资料" subtitle="完整实名资料与照片单独授权。照片替换后，已归档名册仍保留原版本。" :sections="[{ key: 'identity', label: '实名与银行' }, { key: 'contract', label: '劳动合同' }, { key: 'photos', label: '照片原件' }]" :state="current ? 'ready' : busy ? 'loading' : 'error'" state-title="私密资料未能读取" :state-description="error" state-action-label="重新读取" @state-action="ui.load()" @back="ui.leave">
    <p v-if="error && current" role="alert" class="panel mb-4 p-4 text-warn">
      {{ error }}
    </p>
    <section v-if="pending" class="panel mb-4 flex flex-wrap items-center gap-3 p-4" role="status">
      <span>上次提交结果待核对，核对前暂停新的保存。</span><KitButton :disabled="busy || !current" @click="ui.recover">
        核对原提交
      </KitButton>
    </section>
    <template v-if="current">
      <section id="section-identity" class="panel mb-4 p-4">
        <SectionHeader :title="current.worker.name" subtitle="以下来自工人主档；缺失资料在工人表单补充。" />
        <dl class="mt-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <div v-for="item in [{ label: '性别', value: current.worker.gender }, { label: '籍贯', value: current.worker.hometown }, { label: '身份证号', value: current.worker.idCard }, { label: '联系电话', value: current.worker.phone }, { label: '开户行', value: current.worker.bankName }, { label: '银行账号', value: current.worker.bankAccount }, { label: '进场日期', value: current.worker.entryDate }, { label: '退场日期', value: current.worker.exitDate }]" :key="item.label" class="min-w-0">
            <dt class="text-12px text-ink-soft">
              {{ item.label }}
            </dt><dd class="mt-1 break-all text-13px">
              {{ item.value || '未记录' }}
            </dd>
          </div>
        </dl>
        <NuxtLink v-if="current.context.capabilities.includes('worker:write')" :to="`/base/worker/form/${encodeURIComponent(current.worker.id)}?origin=real`" class="btn-secondary mt-4">
          编辑工人主档
        </NuxtLink>
      </section>
      <section id="section-contract" class="panel mb-4 p-4">
        <SectionHeader title="劳动合同签订事实" :subtitle="`资料版本 ${current.revision}；不根据工资发放状态推断是否签订。`" />
        <div class="mt-4 grid gap-4 sm:grid-cols-2">
          <label class="grid gap-1 text-12px">签订情况<select aria-label="签订情况" class="field-input" :value="values.laborContractSigned === null ? 'unknown' : String(values.laborContractSigned)" :disabled="!writable" @change="values.laborContractSigned = ($event.target as HTMLSelectElement).value === 'unknown' ? null : ($event.target as HTMLSelectElement).value === 'true'; if (!values.laborContractSigned) values.laborContractSignedOn = null"><option value="unknown">未记录</option><option value="true">已签订</option><option value="false">未签订</option></select></label>
          <label class="grid gap-1 text-12px">签订日期<input aria-label="签订日期" :value="values.laborContractSignedOn ?? ''" type="date" class="field-input min-w-0" :disabled="!writable || values.laborContractSigned !== true" @input="values.laborContractSignedOn = ($event.target as HTMLInputElement).value || null"></label>
        </div>
      </section>
      <section id="section-photos" class="panel p-4">
        <SectionHeader title="两类照片原件" subtitle="用途须人工明确。旧附件不按文件名推断用途，缺正文的附件不能作为有效照片。支持 PNG/JPEG，每张不超过 20 MB。" />
        <div class="mt-4 grid gap-4 lg:grid-cols-2">
          <fieldset v-for="photo in photos" :key="photo.purpose" class="min-w-0 rounded-lg border border-line p-4">
            <legend class="px-1 text-13px font-700">
              {{ photo.label }}
            </legend>
            <label class="grid gap-1 text-12px">选用已有原件<select v-model="values[photo.field]" class="field-input min-w-0" :disabled="!writable || !!uploads[photo.purpose]"><option :value="null">尚未关联</option><option v-for="asset in current.assets" :key="asset.id" :value="asset.id" :disabled="asset.state !== 'available' || !['image/png', 'image/jpeg'].includes(asset.mimeType)">{{ asset.fileName }}{{ asset.state === 'missing' ? '（缺正文）' : '' }}{{ asset.legacyCategory ? ` · 旧类别：${asset.legacyCategory}` : '' }}</option></select></label>
            <label class="mt-3 grid gap-1 text-12px">上传新的{{ photo.label }}<input type="file" accept="image/png,image/jpeg" class="min-w-0 w-full text-12px" :aria-label="`上传${photo.label}`" :disabled="!writable" @change="ui.choosePhoto(photo.purpose, ($event.target as HTMLInputElement).files?.[0])"></label>
            <p v-if="uploads[photo.purpose]" class="mt-2 break-all text-12px">
              待保存：{{ uploads[photo.purpose]?.fileName }} <KitButton size="sm" :disabled="!writable" @click="delete uploads[photo.purpose]">
                取消新照片
              </KitButton>
            </p>
            <KitButton v-if="values[photo.field]" class="mt-3" :disabled="busy" @click="ui.download(values[photo.field]!)">
              下载当前原件
            </KitButton>
          </fieldset>
        </div>
      </section>
    </template>
    <template #footer>
      <div class="flex flex-wrap justify-end gap-2">
        <KitButton variant="secondary" :disabled="busy || !!pending" @click="ui.leave">
          返回工人
        </KitButton><KitButton variant="primary" :disabled="!writable || !dirty" @click="ui.save">
          {{ busy ? '正在处理…' : '保存资料与照片' }}
        </KitButton>
      </div>
    </template>
  </EntityFormShell>
</template>
