<script setup lang="ts">
import type { OtherSettlementDetail } from '~/lib/other-settlement/contract'
import type { EntityRefDTO } from '~/types/read-model'
import OtherSettlementOriginalFiles from '~/components/other-settlement/OtherSettlementOriginalFiles.vue'
import { auxiliaryMoney } from '~/lib/auxiliary-contract/presentation'
import { resolveNavigationTarget } from '~/lib/nav/target-registry'
import { OTHER_SETTLEMENT_AMOUNT_LABELS } from '~/lib/other-settlement/contract'

const props = defineProps<{
  detail: OtherSettlementDetail
}>()
const root = useTemplateRef<HTMLElement>('root')
const navigation = useOtherSettlementNavigation(root)
const settlement = computed(() => props.detail.settlement)
function relation(ref: EntityRefDTO) {
  const result = resolveNavigationTarget({ kind: 'entity-detail', subject: ref, variant: ref.entity === 'contract' ? 'other_expense' : 'detail', view: null, filters: { dataOrigin: 'real', ...(ref.entity === 'contract' ? { contractKind: 'other_expense' } : {}) } }, { returnTo: navigation.context(`settlement-relation-${ref.entity}`) })
  return result.state === 'resolved' ? result.to : null
}
const groups = [
  { title: '前期信息', keys: ['contract', 'changedContract', 'prior'] },
  { title: '结算信息', keys: ['total', 'deductions', 'net', 'taxExclusive', 'tax'] },
  { title: '累计与应付信息', keys: ['cumulative', 'applied', 'applicable', 'paid', 'unpaid'] },
] as const
const selectedVersion = ref(props.detail.settlement.version)
watch(() => props.detail.settlement.id, () => {
  selectedVersion.value = props.detail.settlement.version
})
const snapshot = computed(() => props.detail.history?.find(row => row.version === selectedVersion.value)?.record)
const versionFiles = computed(() => snapshot.value?.attachments ?? props.detail.attachments)
</script>

<template>
  <div ref="root" class="grid min-w-0 gap-3 xl:grid-cols-[minmax(0,2fr)_minmax(240px,1fr)]">
    <div class="min-w-0 space-y-3">
      <p v-if="settlement.qualificationUnavailableReason" role="status" class="panel break-words p-4 text-13px">
        {{ settlement.qualificationUnavailableReason }}
      </p>
      <section class="panel p-4">
        <SectionHeader title="基础信息" />
        <dl class="mt-3 grid gap-4 text-13px sm:grid-cols-2 lg:grid-cols-3">
          <div v-for="item in [{ label: '项目名称', ref: settlement.project }, { label: '合同名称', ref: settlement.contract }, { label: '分供方', ref: settlement.supplier }]" :key="item.label" class="min-w-0 break-words">
            <dt class="mb-2 text-ink-soft">
              {{ item.label }}
            </dt><dd>
              <NuxtLink v-if="relation(item.ref)" :id="`settlement-relation-${item.ref.entity}`" :to="relation(item.ref)!" class="text-brand underline" @click="navigation.remember(`settlement-relation-${item.ref.entity}`)">
                {{ item.ref.label }}
              </NuxtLink><span v-else>关系不可用：未记录或已失效</span>
            </dd>
          </div>
          <div>
            <dt class="mb-2 text-ink-soft">
              实际垫付收款人
            </dt><dd class="break-words">
              {{ settlement.draft.payeeNameSnapshot || '历史未明确，不按服务方或同名补映射' }}
            </dd>
          </div><div>
            <dt class="mb-2 text-ink-soft">
              结算日期
            </dt><dd>{{ settlement.draft.settlementDate || '未记录' }}</dd>
          </div><div>
            <dt class="mb-2 text-ink-soft">
              结算类型
            </dt><dd>{{ settlement.draft.settlementType || '未记录' }}</dd>
          </div><div>
            <dt class="mb-2 text-ink-soft">
              结算期间
            </dt><dd>{{ settlement.draft.period || '未记录' }}</dd>
          </div>
          <div class="col-span-full">
            <dt class="mb-2 text-ink-soft">
              扣减说明
            </dt><dd class="break-words">
              {{ settlement.draft.deductionNote || '未记录' }}
            </dd>
          </div><div class="col-span-full">
            <dt class="mb-2 text-ink-soft">
              备注
            </dt><dd class="break-words">
              {{ settlement.draft.note || '未记录' }}
            </dd>
          </div>
        </dl>
      </section>
      <section v-for="group in groups" :key="group.title" class="panel p-4">
        <SectionHeader :title="group.title" /><dl class="mt-3 grid gap-4 text-13px sm:grid-cols-2 lg:grid-cols-3">
          <div v-for="key in group.keys" :key="key" role="group" :aria-label="OTHER_SETTLEMENT_AMOUNT_LABELS[key]">
            <dt class="mb-2 text-ink-soft">
              {{ OTHER_SETTLEMENT_AMOUNT_LABELS[key] }}
            </dt><dd class="font-mono">
              {{ auxiliaryMoney(settlement.amounts[key]) }}
            </dd>
          </div>
        </dl>
      </section>
      <section class="panel p-4">
        <SectionHeader title="结算附件与冻结版本" />
        <label v-if="detail.history?.length" class="my-3 block text-13px">查看冻结版本<select v-model="selectedVersion" class="field-input ml-2 max-w-full"><option v-for="row in detail.history" :key="row.version" :value="row.version">版本 {{ row.version }} · {{ row.occurredAt }}</option></select></label>
        <p v-if="snapshot" class="break-words text-13px">
          冻结名称 {{ snapshot.draft.name || '未记录' }} · 含税金额 {{ snapshot.draft.totalAmount === null || snapshot.draft.totalAmount === undefined ? '未知' : snapshot.draft.totalAmount.toFixed(2) }} · 收款人 {{ snapshot.draft.payeeNameSnapshot || '未记录' }}
        </p>
        <OtherSettlementOriginalFiles :id="settlement.id" :version="selectedVersion" :files="versionFiles" :can-read="detail.capabilities.includes('other-settlement:read')" />
      </section>
      <section v-for="source in detail.sourceHistory" :key="source.sourceBytesSha256" class="panel min-w-0 p-4">
        <SectionHeader title="Native 历史证据" /><p class="break-all text-12px text-ink-soft">
          完整原库摘要 {{ source.sourceBytesSha256 }}
        </p><p class="text-13px">
          原编号 {{ source.rawHead.no || '未记录' }} · 原创建人 {{ source.rawHead.created_by || '未记录' }} · 原收款名 {{ source.rawHead.payee_name_snapshot || '未记录' }}
        </p><details class="min-w-0">
          <summary class="cursor-pointer text-13px">
            查看原命令、审计和冻结历史（只读）
          </summary><pre class="max-h-100 overflow-auto whitespace-pre-wrap break-all rounded bg-surface-2 p-3 text-12px">{{ JSON.stringify({ history: source.history, commands: source.commands, audit: source.audit, retained: source.retained }, null, 2) }}</pre>
        </details>
      </section>
    </div>
    <aside class="panel self-start p-4">
      <SectionHeader title="系统信息" /><dl class="mt-3 space-y-4 break-words text-13px">
        <div v-for="item in [{ key: 'responsible', label: '负责人' }, { key: 'department', label: '所属部门' }, { key: 'createdBy', label: '创建人' }, { key: 'createdAt', label: '创建时间' }, { key: 'updatedBy', label: '修改人' }, { key: 'updatedAt', label: '修改时间' }]" :key="item.key">
          <dt class="mb-2 text-ink-soft">
            {{ item.label }}
          </dt><dd>{{ settlement.audit[item.key as keyof typeof settlement.audit] || '未记录' }}</dd>
        </div>
      </dl><p class="mt-4 border-t border-line pt-3 text-12px leading-6 text-ink-soft">
        仅展示已有审计事实。未记录的审批人员、流程与结算明细不可用。
      </p>
    </aside>
  </div>
</template>
