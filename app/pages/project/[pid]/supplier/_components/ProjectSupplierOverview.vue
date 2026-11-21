<script setup lang="ts">
import type { ProjectSupplierWorkbenchReadDTO } from '~/lib/project-supplier/repository'
import ContextHelp from '~/components/ui/ContextHelp.vue'

defineProps<{ data: ProjectSupplierWorkbenchReadDTO, returnTo: string }>()
</script>

<template>
  <div class="grid min-w-0 gap-3 lg:grid-cols-2">
    <section class="panel p-4" aria-labelledby="project-profile-title">
      <div class="flex items-center gap-1.5">
        <h2 id="project-profile-title" class="m-0 text-13px font-800 text-ink">
          项目身份
        </h2>
        <ContextHelp label="工作台数据" text="本页汇总该项目与分供方的合同、请款、收票、付款、结算及文件。修改请前往对应业务单据；最终结算登记暂不可用。" />
      </div>
      <EntityLink class="mt-3 block text-15px" type="project" :intent="data.projectNavigation" :label="data.project.label" :return-to="returnTo" />
      <dl class="mt-4 grid grid-cols-2 gap-3 text-11px">
        <div>
          <dt class="text-ink-faint">
            项目状态
          </dt><dd class="m-0 mt-1 text-ink">
            {{ data.projectProfile.status || '未记录' }}
          </dd>
        </div>
        <div>
          <dt class="text-ink-faint">
            项目经理
          </dt><dd class="m-0 mt-1 text-ink">
            {{ data.projectProfile.manager || '未记录' }}
          </dd>
        </div>
        <div class="col-span-2">
          <dt class="text-ink-faint">
            建设单位
          </dt><dd class="m-0 mt-1 text-ink">
            {{ data.projectProfile.developer || '未记录' }}
          </dd>
        </div>
      </dl>
    </section>
    <section class="panel p-4" aria-labelledby="supplier-profile-title">
      <h2 id="supplier-profile-title" class="m-0 text-13px font-800 text-ink">
        分供方身份
      </h2>
      <EntityLink class="mt-3 block text-15px" type="supplier" :intent="data.supplierNavigation" :label="data.supplier.label" :return-to="returnTo" />
      <dl class="mt-4 grid grid-cols-2 gap-3 text-11px">
        <div>
          <dt class="text-ink-faint">
            供应类别
          </dt><dd class="m-0 mt-1 text-ink">
            {{ data.supplierProfile.supplierCategory || '未记录' }}
          </dd>
        </div>
        <div>
          <dt class="text-ink-faint">
            联系人
          </dt><dd class="m-0 mt-1 text-ink">
            {{ data.supplierProfile.contact || '未记录' }}
          </dd>
        </div>
        <div class="col-span-2">
          <dt class="text-ink-faint">
            联系电话
          </dt><dd class="m-0 mt-1 text-ink">
            {{ data.supplierProfile.contactPhone || '未记录' }}
          </dd>
        </div>
      </dl>
    </section>
  </div>
</template>
