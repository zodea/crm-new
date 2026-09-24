<script setup lang="ts">
import type { SupplierCredentialRequirementRecord } from '~/lib/supplier/credential-contract'
import { SUPPLIER_CREDENTIAL_REQUIREMENT_LABELS } from '~/lib/supplier/credential-form'
import { REQUIRED_SUPPLIER_CREDENTIALS } from '~/lib/supplier/credentials'

defineProps<{ requirements: readonly SupplierCredentialRequirementRecord[], canWrite: boolean }>()
defineEmits<{ edit: [requirement: SupplierCredentialRequirementRecord] }>()
</script>

<template>
  <section class="panel min-w-0 p-4" aria-labelledby="central-credential-requirement-title">
    <h3 id="central-credential-requirement-title" class="m-0 text-14px font-700 text-ink">
      证照要求
    </h3>
    <p class="mb-3 mt-1 text-12px leading-5 text-ink-soft">
      基本资料需提供；条件资料按实际业务维护要求和原因。
    </p>
    <ul class="m-0 grid list-none grid-cols-[repeat(auto-fit,minmax(min(100%,13rem),1fr))] gap-2 p-0">
      <li v-for="row in requirements" :key="row.category" class="min-w-0 border border-line bg-surface-2 p-3">
        <div class="flex flex-wrap items-center gap-2">
          <strong class="mr-auto text-12px text-ink">{{ row.category }}</strong>
          <span class="text-11px text-ink-soft">{{ SUPPLIER_CREDENTIAL_REQUIREMENT_LABELS[row.requirement] }}</span>
          <button v-if="canWrite && !REQUIRED_SUPPLIER_CREDENTIALS.includes(row.category)" type="button" class="icon-btn" :aria-label="`维护${row.category}要求`" @click="$emit('edit', row)">
            <span class="i-lucide-pencil text-12px" aria-hidden="true" />
          </button>
        </div>
        <p v-if="row.reason" class="mb-0 mt-1 break-words text-11px leading-5 text-ink-faint">
          原因：{{ row.reason }}
        </p>
      </li>
    </ul>
  </section>
</template>
