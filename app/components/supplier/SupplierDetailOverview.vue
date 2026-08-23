<script setup lang="ts">
import type { SupplierListSourceRow } from '~/lib/supplier/repository'

defineProps<{ supplier: SupplierListSourceRow }>()
</script>

<template>
  <section class="panel min-w-0 overflow-hidden" aria-labelledby="supplier-basic-heading">
    <div class="border-b border-line px-4 py-3">
      <h3 id="supplier-basic-heading" class="m-0 text-14px font-800 text-ink">
        分供方主数据
      </h3>
      <p class="m-0 mt-1 text-11px text-ink-soft">
        合同、结算、收票和付款均通过稳定分供方 ID 关联，不按名称或金额猜测。
      </p>
    </div>
    <dl class="grid min-w-0 grid-cols-1 gap-x-6 gap-y-4 p-4 sm:grid-cols-2 xl:grid-cols-3">
      <div>
        <dt class="text-11px text-ink-faint">
          统一社会信用代码
        </dt><dd class="m-0 mt-1 break-all font-mono text-13px text-ink">
          {{ supplier.taxNo || '—' }}
        </dd>
      </div>
      <div>
        <dt class="text-11px text-ink-faint">
          内部编码
        </dt><dd class="m-0 mt-1 break-all font-mono text-13px text-ink">
          {{ supplier.uniqueCode || '—' }}
        </dd>
      </div>
      <div>
        <dt class="text-11px text-ink-faint">
          分供方类别
        </dt><dd class="m-0 mt-1 text-13px text-ink">
          {{ supplier.supplierCategory || '—' }}
        </dd>
      </div>
      <div>
        <dt class="text-11px text-ink-faint">
          法定代表人
        </dt><dd class="m-0 mt-1 text-13px text-ink">
          {{ supplier.legalRep || '—' }}
        </dd>
      </div>
      <div>
        <dt class="text-11px text-ink-faint">
          主要联系人
        </dt><dd class="m-0 mt-1 text-13px text-ink">
          {{ supplier.contact || '—' }}
        </dd>
      </div>
      <div>
        <dt class="text-11px text-ink-faint">
          联系电话
        </dt><dd class="m-0 mt-1 break-all font-mono text-13px text-ink">
          {{ supplier.contactPhone || '—' }}
        </dd>
      </div>
      <div class="sm:col-span-2">
        <dt class="text-11px text-ink-faint">
          注册地址
        </dt><dd class="m-0 mt-1 break-words text-13px text-ink">
          {{ supplier.address || '—' }}
        </dd>
      </div>
      <div>
        <dt class="text-11px text-ink-faint">
          开户银行
        </dt><dd class="m-0 mt-1 break-words text-13px text-ink">
          {{ supplier.bank || '—' }}
        </dd>
      </div>
      <div>
        <dt class="text-11px text-ink-faint">
          银行账号
        </dt><dd class="m-0 mt-1 break-all font-mono text-13px text-ink">
          {{ supplier.bankAccount || '—' }}
        </dd>
      </div>
      <div class="sm:col-span-2">
        <dt class="text-11px text-ink-faint">
          主营业务
        </dt><dd class="m-0 mt-1 break-words text-13px text-ink">
          {{ supplier.mainBusiness || '—' }}
        </dd>
      </div>
      <div class="sm:col-span-2 xl:col-span-3">
        <dt class="text-11px text-ink-faint">
          备注
        </dt><dd class="m-0 mt-1 whitespace-pre-wrap break-words text-13px text-ink">
          {{ supplier.note || '—' }}
        </dd>
      </div>
    </dl>
  </section>
</template>
