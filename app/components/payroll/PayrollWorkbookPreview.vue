<script setup lang="ts">
import type { PayrollWorkbookArchive, PayrollWorkbookPreview } from '~/lib/payroll/central-workbook-contract'
import { computed } from 'vue'
import { payrollAmount } from '~/lib/payroll/read-presentation'

const props = defineProps<{ document: PayrollWorkbookArchive | PayrollWorkbookPreview, returnTo: string, disabled: boolean }>()
const entries = computed(() => props.document.groups.flatMap(group => group.entries))
const issues = computed(() => new Map(props.document.issues.map(issue => [issue.statementId, issue])))
const saved = computed(() => 'manifestHash' in props.document ? props.document : null)
</script>

<template>
  <section id="section-preview" class="panel min-w-0 p-4" aria-label="工资目录预览">
    <SectionHeader :title="saved ? `已保存目录 · 版本 ${saved.version}` : '待保存目录预览'" subtitle="普通工资、独立管理费簿、考勤与签工原表分别保留；部分资料不会伪称附件齐全。" />
    <p v-if="saved" class="mt-3 break-all text-12px text-ink-soft">
      保存时点 {{ saved.createdAt }} · {{ saved.id }} · {{ saved.completeness === 'complete' ? '目录资料完整' : '目录资料部分' }}。保存目录不代表文件已下载。
    </p>
    <p v-if="document.rosterRef" class="mt-3 break-all text-12px">
      固定名册：{{ document.rosterRef.registeredOn }} · 版本 {{ document.rosterRef.version }} · {{ document.rosterRef.id }}。此为独立日期的资料补充，不冒充工资发放时原件。
    </p>
    <div class="mt-4 max-w-full overflow-x-auto" tabindex="0" aria-label="目录工资明细">
      <table class="w-full min-w-760px border-collapse text-12px">
        <thead>
          <tr class="text-left">
            <th class="border-b border-line p-2">
              月份 / 原工资
            </th><th class="border-b border-line p-2">
              负责人 / 格式
            </th><th class="border-b border-line p-2">
              正式编号
            </th><th class="border-b border-line p-2 text-right">
              本单应发
            </th><th class="border-b border-line p-2 text-right">
              冻结实发
            </th><th class="border-b border-line p-2">
              原件
            </th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="entry in entries" :key="entry.document.id">
            <td class="max-w-64 break-all border-b border-line p-2">
              {{ entry.document.month }}<span class="mt-1 block text-ink-soft">{{ entry.document.id }}</span>
            </td><td class="border-b border-line p-2">
              {{ entry.document.leaderName }} · {{ entry.document.formatFamily }}<span v-if="entry.row.book?.bookPurpose === 'management'" class="block">独立管理费簿</span>
            </td><td class="border-b border-line p-2">
              {{ issues.get(entry.document.id)?.number || '尚未正式出具' }}
            </td><td class="border-b border-line p-2 text-right">
              {{ payrollAmount(entry.document.grossAmount) }}
            </td><td class="border-b border-line p-2 text-right">
              {{ payrollAmount(entry.document.actualAmount) }}
            </td><td class="border-b border-line p-2">
              <NuxtLink v-if="!disabled" class="text-brand underline" :to="{ path: `/subcontract/payroll/issue/${encodeURIComponent(entry.document.id)}`, query: { origin: 'real', project: document.input.projectId, returnTo } }">
                {{ issues.has(entry.document.id) ? '查看正式原件' : '核对正式出具' }}
              </NuxtLink><span v-else>处理中</span>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
    <div v-if="document.gaps.length || document.deliveryGaps.length" class="mt-4 rounded-md border border-warning bg-warn-soft p-3 text-12px" role="status">
      <strong>保留的资料缺口</strong><p v-for="gap in document.gaps" :key="`wage-${gap.statementId}`" class="mt-2 break-words">
        {{ gap.month }} · {{ gap.statementId }}：{{ gap.reason }}
      </p><p v-for="(gap, index) in document.deliveryGaps" :key="`delivery-${index}`" class="mt-2 break-words">
        {{ gap.reason }}
      </p>
    </div>
    <p v-if="'eligibility' in document && document.eligibility.reasons.length" class="mt-3 text-12px text-warn">
      {{ document.eligibility.reasons.join('；') }}
    </p>
  </section>
</template>
