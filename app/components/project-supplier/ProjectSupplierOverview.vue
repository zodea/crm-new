<script setup lang="ts">
import type { ProjectSupplierWorkbenchReadDTO } from '~/lib/project-supplier/repository'

defineProps<{ data: ProjectSupplierWorkbenchReadDTO }>()
</script>

<template>
  <div class="grid min-w-0 gap-3 lg:grid-cols-2">
    <section class="panel p-4" aria-labelledby="project-profile-title">
      <h2 id="project-profile-title" class="m-0 text-13px font-800 text-ink">
        项目身份
      </h2>
      <EntityLink class="mt-3 block text-15px" type="project" :intent="data.projectNavigation" :label="data.project.label" />
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
      <EntityLink class="mt-3 block text-15px" type="supplier" :intent="data.supplierNavigation" :label="data.supplier.label" />
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
    <section class="panel p-4 lg:col-span-2" aria-labelledby="fact-boundary-title">
      <h2 id="fact-boundary-title" class="m-0 text-13px font-800 text-ink">
        事实口径
      </h2>
      <p class="m-0 mt-2 text-11px leading-5 text-ink-soft">
        本页只读汇总中央 Repository 返回的合同、请款、收票、付款、结算与文件事实；源单维护仍在各业务模块完成。最终结算写入规则尚未定稿，本工作台不提供终态写入入口。
      </p>
    </section>
  </div>
</template>
