<script setup lang="ts">
import type { usePayrollANegativeLines } from '~/composables/usePayrollANegativeLines'
import PayrollACommandState from '~/components/payroll/PayrollACommandState.vue'
import PayrollANegativeLineEditor from './PayrollANegativeLineEditor.vue'

const props = defineProps<{ ui: ReturnType<typeof usePayrollANegativeLines> }>()
const route = useRoute()
const { current, matching, scopeRead, rows, removed, pending, busy, editable, dirty, error, errorPanel, actualFacts, actualStatements, referenceReady, referenceLoading, referenceError } = props.ui
</script>

<template>
  <section v-if="current" id="section-negative" class="panel grid grid-cols-1 min-w-0 scroll-mt-4 gap-3 p-4" aria-label="管理清单负价编辑">
    <SectionHeader title="负价代付清单" subtitle="数量乘负单价进入本管理单清单合计；实际收付另行留证。" />
    <PayrollACommandState ref="errorPanel" :pending="!!pending" :awaiting-read="pending?.state === 'awaiting-read'" :busy="busy" :error="error" focusable @recover="ui.execute(true)" @refresh="ui.reload" />
    <p v-if="current.status === 'released'" class="text-12px text-ink-faint">
      已发清单冻结，请从原单发起独立更正。
    </p>
    <template v-else>
      <p v-if="dirty && matching?.context.sourceVersion !== current.context.sourceVersion" class="text-12px text-warn">
        原稿使用的管理单依据已有变化，请核对后明确采用。
      </p>
      <KitButton v-if="dirty && matching?.context.sourceVersion !== current.context.sourceVersion" type="button" variant="secondary" class="justify-self-start" :disabled="!editable" @click="ui.recheck">
        保留负价稿并采用当前依据
      </KitButton>
      <KitButton type="button" variant="secondary" class="justify-self-start" :disabled="!editable || referenceLoading" @click="ui.loadReferences">
        {{ referenceLoading ? '正在读取实际收付…' : '读取可关联的已有实际收付' }}
      </KitButton>
      <p v-if="referenceError" role="status" class="text-12px text-warn">
        {{ referenceError }} 原引用和负价稿已保留。
      </p>
      <p v-if="referenceReady && !actualFacts.length" class="text-12px text-ink-faint">
        本项目当前没有可关联的已证实际收付。
      </p>
      <PayrollANegativeLineEditor v-for="row in rows" :key="row.key" :draft="row.draft" :options="scopeRead?.responsibilityOptions ?? []" :cell-options="scopeRead?.cellOptions" :return-to="route.fullPath" :actual-facts="actualFacts" :actual-statements="actualStatements" :reference-ready="referenceReady" :disabled="!editable" @change="ui.change(row.key, $event)" @remove="ui.remove(row.key)" />
      <p v-if="removed.length" class="text-12px text-warn">
        待移除 {{ removed.length }} 条原负价行，保存时追加移除修订。
      </p>
      <div class="flex flex-wrap gap-2">
        <KitButton type="button" variant="secondary" :disabled="!editable" @click="ui.add">
          新增负价代付行
        </KitButton><KitButton type="button" :disabled="!editable || !dirty" @click="ui.execute()">
          保存负价清单
        </KitButton>
      </div>
      <p v-if="dirty" class="text-12px text-ink-faint">
        先保存本区，再核对工资；未保存的负价稿不会随普通工资保存丢失。
      </p>
    </template>
  </section>
</template>
