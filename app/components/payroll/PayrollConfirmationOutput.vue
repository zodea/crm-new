<script setup lang="ts">
import type { PayrollConfirmationDocument } from '~/lib/payroll/adjustment-output'
import { nextTick, shallowRef } from 'vue'
import { createPayrollConfirmationWorkbook } from '~/lib/payroll/adjustment-output'
import { toErrorMessage } from '~/lib/util/error'

const props = defineProps<{ document: PayrollConfirmationDocument | null, active: boolean }>()
const kit = useKitUI()
const error = shallowRef('')
async function download() {
  if (!props.document || !props.active)
    return
  try {
    await kit.exportFile(createPayrollConfirmationWorkbook(props.document))
  }
  catch (cause) { error.value = toErrorMessage(cause) }
}
async function print() {
  const document = props.document
  await nextTick()
  if (document && document === props.document && props.active)
    window.print()
}
</script>

<template>
  <section class="panel grid gap-3 p-4" aria-label="独立确认记录输出">
    <SectionHeader title="独立确认记录" /><p v-if="!document" class="text-12px text-warn">
      完整确认依据尚未核实，不能生成独立确认记录。
    </p><template v-else>
      <p class="text-12px text-ink-soft">
        原单签名金额、本次事实及后来处理分别呈现。原工资表仍从原单读取。
      </p><div class="flex flex-wrap gap-2">
        <KitButton @click="print">
          打印确认记录
        </KitButton><KitButton variant="secondary" @click="download">
          下载确认记录
        </KitButton>
      </div>
    </template><p v-if="error" role="alert" class="text-12px text-danger">
      {{ error }}
    </p>
  </section>
  <Teleport v-if="document && active" to="body">
    <div class="payroll-confirmation-print" aria-hidden="true">
      <article class="confirmation-paper" data-payroll-confirmation-print>
        <h1 class="confirmation-title">
          {{ document.title }}
        </h1><section v-for="(section, index) in document.sections" :key="index" class="confirmation-section">
          <h2 class="confirmation-section-title">
            {{ section.title }}
          </h2><table class="confirmation-table">
            <thead>
              <tr>
                <th v-for="(column, columnIndex) in section.columns" :key="columnIndex" class="confirmation-cell">
                  {{ column }}
                </th>
              </tr>
            </thead><tbody>
              <tr v-for="(row, rowIndex) in section.rows" :key="rowIndex" class="confirmation-row">
                <td v-for="(_, columnIndex) in section.columns" :key="columnIndex" class="confirmation-cell">
                  {{ row[columnIndex] ?? '未记录' }}
                </td>
              </tr>
            </tbody>
          </table>
        </section><p class="confirmation-signature">
          核对人：________________ 日期：________________
        </p>
      </article>
    </div>
  </Teleport>
</template>

<style scoped>
.payroll-confirmation-print { display: none; }
@media print {
  :global(html:has(body > .payroll-confirmation-print)) { background: white !important; }
  :global(body:has(> .payroll-confirmation-print) > :not(.payroll-confirmation-print)) { display: none !important; }
  :global(body:has(> .payroll-confirmation-print)) { height: auto !important; overflow: visible !important; background: white !important; }
  .payroll-confirmation-print { display: block !important; width: 100%; color: #111; background: white; }
  .confirmation-paper { padding: 5mm; font-size: 9pt; }
  .confirmation-title { text-align: center; font-size: 17pt; margin-bottom: 6mm; }
  .confirmation-section-title { margin: 5mm 0 2mm; font-size: 11pt; break-after: avoid; }
  .confirmation-table { width: 100%; table-layout: fixed; border-collapse: collapse; }
  .confirmation-table thead { display: table-header-group; }
  .confirmation-cell { border: 1px solid #555; padding: 2mm; overflow-wrap: anywhere; white-space: pre-wrap; text-align: left; }
  .confirmation-row { break-inside: avoid; }
  .confirmation-signature { margin-top: 8mm; break-inside: avoid; }
}
</style>
