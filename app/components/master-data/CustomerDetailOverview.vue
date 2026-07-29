<script setup lang="ts">
import type { CustomerDetailMaster } from '~/lib/customer/detail'

defineProps<{
  customer: CustomerDetailMaster
}>()
</script>

<template>
  <section class="panel min-w-0 overflow-hidden" aria-labelledby="customer-basic-heading">
    <div class="border-b border-line px-4 py-3">
      <h3 id="customer-basic-heading" class="m-0 text-14px font-800 text-ink">
        客户主数据
      </h3>
      <p class="m-0 mt-1 text-11px text-ink-soft">
        项目、施工合同和收款均通过客户 ID 关联，不按名称猜测。
      </p>
    </div>
    <dl class="grid min-w-0 grid-cols-1 gap-x-6 gap-y-4 p-4 sm:grid-cols-2 xl:grid-cols-3">
      <div>
        <dt class="text-11px text-ink-faint">
          统一社会信用代码
        </dt>
        <dd class="m-0 mt-1 break-all text-13px text-ink">
          {{ customer.taxNo || '—' }}
        </dd>
      </div>
      <div>
        <dt class="text-11px text-ink-faint">
          法定代表人
        </dt>
        <dd class="m-0 mt-1 text-13px text-ink">
          {{ customer.legalRep || '—' }}
        </dd>
      </div>
      <div>
        <dt class="text-11px text-ink-faint">
          联系人
        </dt>
        <dd class="m-0 mt-1 text-13px text-ink">
          {{ customer.contact || '—' }}
        </dd>
      </div>
      <div>
        <dt class="text-11px text-ink-faint">
          联系电话
        </dt>
        <dd class="m-0 mt-1 break-all text-13px text-ink">
          {{ customer.contactPhone || '—' }}
        </dd>
      </div>
      <div class="sm:col-span-2">
        <dt class="text-11px text-ink-faint">
          注册地址
        </dt>
        <dd class="m-0 mt-1 break-words text-13px text-ink">
          {{ customer.registeredAddress || '—' }}
        </dd>
      </div>
      <div>
        <dt class="text-11px text-ink-faint">
          开票名称
        </dt>
        <dd class="m-0 mt-1 break-words text-13px text-ink">
          {{ customer.invoiceName || '—' }}
        </dd>
      </div>
      <div>
        <dt class="text-11px text-ink-faint">
          开户银行
        </dt>
        <dd class="m-0 mt-1 break-words text-13px text-ink">
          {{ customer.bank || '—' }}
        </dd>
      </div>
      <div>
        <dt class="text-11px text-ink-faint">
          银行账号
        </dt>
        <dd class="m-0 mt-1 break-all font-mono text-13px text-ink">
          {{ customer.bankAccount || '—' }}
        </dd>
      </div>
      <div class="sm:col-span-2 xl:col-span-3">
        <dt class="text-11px text-ink-faint">
          备注
        </dt>
        <dd class="m-0 mt-1 whitespace-pre-wrap break-words text-13px text-ink">
          {{ customer.note || '—' }}
        </dd>
      </div>
    </dl>
  </section>
</template>
