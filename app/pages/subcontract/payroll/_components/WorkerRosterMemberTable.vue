<script setup lang="ts">
import type { WorkerRosterPreview } from '~/lib/worker-roster/contract'

defineProps<{ document: WorkerRosterPreview }>()
const statuses = { 'present': '在场', 'left': '已退场', 'not-entered': '未进场', 'unknown': '未知' }
</script>

<template>
  <section class="panel min-w-0 overflow-hidden" aria-label="名册成员">
    <SectionHeader class="p-4" :title="`${document.projectName} · ${document.members.length} 人`" :subtitle="`登记日期 ${document.scope.registeredOn}；在场 ${document.counts.present}，已退场 ${document.counts.left}，未进场 ${document.counts.notEntered}，状态未知 ${document.counts.unknown}。`" />
    <div class="max-w-full overflow-x-auto" tabindex="0" aria-label="实名名册横向滚动区域">
      <table class="w-full min-w-1250px border-collapse text-left text-12px">
        <thead class="bg-canvas text-ink-soft">
          <tr>
            <th class="p-3">
              姓名 / 工资成员
            </th><th class="p-3">
              性别 / 籍贯
            </th><th class="p-3">
              身份证号
            </th><th class="p-3">
              开户行 / 账号
            </th><th class="p-3">
              劳动合同
            </th><th class="p-3">
              进退场 / 登记日在场
            </th><th class="p-3">
              照片
            </th><th class="min-w-200px p-3">
              资料缺口
            </th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="member in document.members" :key="member.workerId" class="border-t border-line align-top">
            <td class="p-3">
              <NuxtLink :to="`/base/worker/private/${encodeURIComponent(member.workerId)}?origin=real`" class="text-brand underline">
                {{ member.profile?.name || '资料不可用' }}
              </NuxtLink><p class="mt-1">
                原工资：{{ member.payrollNames.join(' / ') }}
              </p><p v-if="member.isLeader" class="mt-1 text-ink-soft">
                请款负责人
              </p><p class="mt-1 max-w-180px break-all text-ink-faint">
                {{ member.workerId }}
              </p>
            </td>
            <td class="p-3">
              {{ member.profile?.gender || '未记录' }}<p class="mt-1">
                {{ member.profile?.hometown || '未记录' }}
              </p>
            </td>
            <td class="whitespace-nowrap p-3">
              {{ member.profile?.idCard || '未记录' }}
            </td>
            <td class="whitespace-nowrap p-3">
              {{ member.profile?.bankName || '未记录' }}<p class="mt-1">
                {{ member.profile?.bankAccount || '未记录' }}
              </p>
            </td>
            <td class="whitespace-nowrap p-3">
              {{ member.values.laborContractSigned === null ? '未记录' : member.values.laborContractSigned ? '已签订' : '未签订' }}<p class="mt-1">
                {{ member.values.laborContractSignedOn || '无签订日期记录' }}
              </p>
            </td>
            <td class="whitespace-nowrap p-3">
              进：{{ member.profile?.entryDate || '未记录' }}<p class="mt-1">
                退：{{ member.profile?.exitDate || '未记录' }}
              </p><p class="mt-1">
                {{ statuses[member.siteStatus] }}
              </p>
            </td>
            <td class="p-3">
              <p v-for="purpose in (['portrait', 'bank-card'] as const)" :key="purpose" class="whitespace-nowrap">
                {{ purpose === 'portrait' ? '证件照' : '银行卡照' }}：{{ member.photos.find(photo => photo.purpose === purpose)?.state === 'available' ? '有原件' : '缺原件' }}
              </p>
            </td>
            <td class="p-3">
              <ul v-if="member.diagnostics.length" class="grid list-disc gap-1 pl-4 text-warn">
                <li v-for="diagnostic in member.diagnostics" :key="diagnostic">
                  {{ diagnostic }}
                </li>
              </ul><span v-else>资料已记录</span>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </section>
</template>
