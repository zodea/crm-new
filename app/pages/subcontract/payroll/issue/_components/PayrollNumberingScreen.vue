<script setup lang="ts">
import { computed } from 'vue'
import PayrollAFrozenPrint from '~/components/payroll/PayrollAFrozenPrint.vue'
import PayrollC1FrozenPrint from '~/components/payroll/PayrollC1FrozenPrint.vue'
import PayrollC2FrozenPrint from '~/components/payroll/PayrollC2FrozenPrint.vue'
import PayrollEvidenceTable from '~/components/payroll/PayrollEvidenceTable.vue'
import PayrollOfficialIdentity from '~/components/payroll/PayrollOfficialIdentity.vue'
import { usePayrollNumbering } from '~/composables/usePayrollNumbering'
import { payrollAdjustmentReturn } from '~/lib/payroll/adjustment-navigation'
import { payrollAmount } from '~/lib/payroll/read-presentation'

const route = useRoute()
const router = useRouter()
const id = computed(() => typeof route.params.id === 'string' ? route.params.id : '')
const projectId = computed(() => typeof route.query.project === 'string' ? route.query.project : '')
const ui = usePayrollNumbering(() => projectId.value, () => id.value)
const { current, printRead, nextNumber, evidenceNote, busy, error, writable, pending } = ui
const document = computed(() => current.value?.document)
const back = computed(() => payrollAdjustmentReturn(route.query.returnTo, 'real') || `/subcontract/payroll/${encodeURIComponent(id.value)}?origin=real`)
const period = computed(() => document.value?.formatFamily === 'A' ? { monthly: '月度请款', settlement: '工程结算', retention: '尾款' }[document.value.periodKind] : '月度100%')
const lineColumns = [{ field: 'workerName', title: '姓名' }, { field: 'itemName', title: '分项', width: 200 }, { field: 'unit', title: '单位' }, { field: 'quantity', title: '数量' }, { field: 'unitPrice', title: '单价' }, { field: 'amount', title: '金额', money: true }]
const allocationColumns = [{ field: 'workerName', title: '收款人' }, { field: 'amount', title: '原实际收款', money: true }]
useTabTitle('预览与正式出具工资')
</script>

<template>
  <EntityFormShell back-label="返回原工资" title="预览与正式出具工资" subtitle="核对原冻结工资后再正式出具。预览不占号，重复下载沿用原正式编号。" :sections="[{ key: 'numbering', label: '项目编号' }, { key: 'preview', label: '冻结工资预览' }, { key: 'output', label: '正式原件' }]" :state="current ? 'ready' : busy ? 'loading' : 'error'" state-title="正式出具资料未能读取" :state-description="error" state-action-label="重新读取" @state-action="ui.load" @back="router.push(back)">
    <p v-if="error && current" role="alert" class="panel mb-4 p-4 text-warn">
      {{ error }}
    </p>
    <section v-if="pending" class="panel mb-4 flex flex-wrap items-center gap-3 p-4" role="status">
      <span>原编号提交结果待核对；核对前不能另建出具记录。</span><KitButton :disabled="busy" @click="ui.submit('recover')">
        核对原编号提交
      </KitButton>
    </section>
    <template v-if="current">
      <section id="section-numbering" class="panel mb-4 p-4">
        <SectionHeader title="项目正式编号" :subtitle="document?.projectName || projectId" />
        <template v-if="current.settings">
          <p class="mt-3 text-13px">
            已登记起点 {{ current.settings.firstNumber }}；下一张可用编号 {{ current.settings.nextNumber }}。此数字是当前序列状态，正式编号以出具回读为准。
          </p>
          <p class="mt-2 break-words text-12px text-ink-soft">
            核对依据：{{ current.settings.evidenceNote }}
          </p>
        </template>
        <template v-else>
          <p class="mt-3 text-13px leading-6 text-ink-soft">
            先核对本项目旧纸质工资号，再明确下一张编号。遇到重复旧号先核对；缺失旧号保持未知，不猜补空号，也不按年份自动重置。
          </p>
          <div class="mt-4 grid gap-4 sm:grid-cols-2">
            <label class="grid gap-1 text-12px">下一张正式编号<input v-model="nextNumber" aria-label="下一张正式编号" inputmode="numeric" class="field-input min-w-0" :disabled="!writable || !current.eligibility.canInitialize" placeholder="人工核对后填写"></label>
            <label class="grid gap-1 text-12px">旧纸号核对依据<textarea v-model="evidenceNote" aria-label="旧纸号核对依据" rows="3" maxlength="2000" class="field-input min-w-0" :disabled="!writable || !current.eligibility.canInitialize" placeholder="记录已查纸质范围、最后确认编号及缺口处理情况" /></label>
          </div>
          <KitButton class="mt-4" :disabled="!writable || !current.eligibility.canInitialize" @click="ui.submit('initialize')">
            登记项目起点
          </KitButton>
        </template>
      </section>
      <section id="section-preview" class="mb-4 grid grid-cols-1 min-w-0 gap-4">
        <div class="panel min-w-0 p-4">
          <SectionHeader title="本份冻结工资预览" subtitle="只使用原发放时已保存的金额与成员，不按当前工程量或资料重新计算。" />
          <template v-if="document">
            <dl class="mt-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              <div>
                <dt class="text-12px text-ink-soft">
                  负责人 / 格式
                </dt><dd class="mt-1 break-words text-13px">
                  {{ document.leaderName }} · {{ document.formatFamily }}
                </dd>
              </div>
              <div>
                <dt class="text-12px text-ink-soft">
                  月份 / 档位
                </dt><dd class="mt-1 text-13px">
                  {{ document.month }} · {{ period }}
                </dd>
              </div>
              <div>
                <dt class="text-12px text-ink-soft">
                  核算应发
                </dt><dd class="mt-1 font-mono font-700">
                  {{ payrollAmount(document.grossAmount) }}
                </dd>
              </div>
              <div>
                <dt class="text-12px text-ink-soft">
                  原实际发放
                </dt><dd class="mt-1 font-mono font-700">
                  {{ payrollAmount(document.actualAmount) }}
                </dd>
              </div>
            </dl>
            <p class="mt-4 break-all text-12px text-ink-soft">
              原工资：{{ document.id }} · 原发放时间：{{ document.releasedAt }}
            </p>
            <p v-if="document.note" class="mt-2 break-words text-13px">
              {{ document.note }}
            </p>
          </template>
          <p v-else class="mt-3 text-13px text-warn">
            原冻结资料尚不能支持正式出具。
          </p>
        </div>
        <template v-if="document">
          <PayrollEvidenceTable title="原工资明细" :rows="document.lines" :columns="lineColumns" />
          <PayrollEvidenceTable title="原实际收款（含零成员）" :rows="document.allocations" :columns="allocationColumns" />
        </template>
      </section>
      <section id="section-output" class="panel p-4">
        <SectionHeader title="正式原件" />
        <template v-if="current.issue">
          <PayrollOfficialIdentity :issue="current.issue" />
          <p class="text-12px leading-6 text-ink-soft">
            重复下载、打印或找回原提交均沿用该编号。输出失败也不会重新占号。
          </p>
          <div class="mt-3 flex flex-wrap gap-2">
            <KitButton :disabled="busy || !!pending || !current.eligibility.canDownload" @click="ui.output('download')">
              下载正式工资 Excel
            </KitButton>
            <KitButton :disabled="busy || !!pending || !current.eligibility.canDownload" @click="ui.output('print')">
              打印正式工资
            </KitButton>
          </div>
        </template>
        <p v-else class="mt-3 text-13px text-ink-soft">
          尚未正式出具，本次预览未占用编号。
        </p>
        <ul v-if="current.eligibility.reasons.length" class="mt-3 grid list-disc gap-1 pl-4 text-12px text-warn">
          <li v-for="reason in current.eligibility.reasons" :key="reason">
            {{ reason }}
          </li>
        </ul>
      </section>
    </template>
    <template #footer>
      <div class="flex flex-wrap justify-end gap-2">
        <KitButton variant="secondary" :disabled="busy || !!pending" @click="router.push(back)">
          返回原工资
        </KitButton>
        <KitButton :disabled="busy || !!pending" @click="ui.load">
          重新核对
        </KitButton>
        <KitButton variant="primary" :disabled="!writable || !current?.eligibility.canIssue || !!current?.issue" @click="ui.submit('issue')">
          确认预览并正式出具
        </KitButton>
      </div>
    </template>
  </EntityFormShell>
  <template v-if="printRead?.issue && printRead.document">
    <PayrollAFrozenPrint v-if="printRead.document.formatFamily === 'A'" :document="printRead.document" :official-issue="printRead.issue" />
    <PayrollC1FrozenPrint v-else-if="printRead.document.formatFamily === 'C1'" :document="printRead.document" :official-issue="printRead.issue" />
    <PayrollC2FrozenPrint v-else :document="printRead.document" :official-issue="printRead.issue" />
  </template>
</template>
