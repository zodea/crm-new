<script setup lang="ts">
import { CONFIDENCE_THRESHOLDS } from '~/lib/invoice/recognize'

const serverVariables = [
  { name: 'NUXT_PADDLE_OCR_ACCESS_TOKEN', purpose: '官方 API Access Token（必需，私密）' },
  { name: 'NUXT_PADDLE_OCR_BASE_URL', purpose: '官方 API 地址（缺省使用项目服务端配置）' },
  { name: 'NUXT_PADDLE_OCR_REQUEST_TIMEOUT_MS', purpose: '提交请求超时' },
  { name: 'NUXT_PADDLE_OCR_POLL_TIMEOUT_MS', purpose: '异步任务轮询总超时' },
]

const unsupportedLocalParameters = [
  '二值化阈值',
  '检测框置信度',
  '外扩比例',
  '最大边长',
  '本地模型档位',
]
</script>

<template>
  <div class="grid min-w-0 gap-4 lg:grid-cols-2">
    <section class="panel min-w-0 p-4" aria-labelledby="ocr-private-config-title">
      <h2 id="ocr-private-config-title" class="m-0 text-15px font-800 text-ink">
        服务端私有配置
      </h2>
      <p class="m-0 mt-1 text-11px leading-5 text-ink-faint">
        修改环境变量并重启本地开发服务后生效；本页不读取、不回显、不保存任何密钥。
      </p>
      <div class="mt-3 max-w-full overflow-x-auto">
        <table class="w-full min-w-560px border-collapse text-12px">
          <thead>
            <tr>
              <th>环境变量</th>
              <th>用途</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="variable in serverVariables" :key="variable.name">
              <td><code>{{ variable.name }}</code></td>
              <td>{{ variable.purpose }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>

    <section class="panel min-w-0 p-4" aria-labelledby="ocr-threshold-title">
      <h2 id="ocr-threshold-title" class="m-0 text-15px font-800 text-ink">
        当前判读边界
      </h2>
      <p class="m-0 mt-1 text-11px leading-5 text-ink-faint">
        置信度仅用于发票校对界面的参考分档，不代表审批或自动归档结果。
      </p>
      <dl class="mt-3 grid gap-2 sm:grid-cols-2">
        <div class="threshold-cell border-ok/30 bg-ok-soft">
          <dt>建议通过</dt>
          <dd>≥ {{ Math.round(CONFIDENCE_THRESHOLDS.ok * 100) }}%</dd>
        </div>
        <div class="threshold-cell border-warn/30 bg-warn-soft">
          <dt>需要注意</dt>
          <dd>≥ {{ Math.round(CONFIDENCE_THRESHOLDS.warn * 100) }}% 且低于建议通过</dd>
        </div>
        <div class="threshold-cell border-danger/30 bg-danger-soft sm:col-span-2">
          <dt>需要复核</dt>
          <dd>低于 {{ Math.round(CONFIDENCE_THRESHOLDS.warn * 100) }}%</dd>
        </div>
      </dl>
      <p class="m-0 mt-3 text-11px leading-5 text-ink-soft">
        当前阈值为代码固定值，尚未建立可持久化的全局阈值配置，因此这里只读展示。
      </p>
    </section>

    <section class="panel min-w-0 p-4 lg:col-span-2" aria-labelledby="ocr-local-boundary-title">
      <div class="flex min-w-0 flex-wrap items-start gap-3">
        <span class="i-lucide-monitor-cog mt-0.5 shrink-0 text-20px text-ink-faint" aria-hidden="true" />
        <div class="min-w-0 flex-1">
          <h2 id="ocr-local-boundary-title" class="m-0 text-15px font-800 text-ink">
            本地自托管参数尚未开放
          </h2>
          <p class="m-0 mt-1 text-11px leading-5 text-ink-faint">
            ADR 0006 已确定本地 PaddleOCR-VL 为目标方案，但当前仓库仍只有官方云端代理。PP-OCRv6 Studio 的传统检测参数不能发送给 VL 云端模型。
          </p>
          <div class="mt-3 flex flex-wrap gap-1.5">
            <span v-for="parameter in unsupportedLocalParameters" :key="parameter" class="status-chip bg-surface-3 text-ink-faint">
              {{ parameter }} · 不可用
            </span>
          </div>
        </div>
      </div>
    </section>
  </div>
</template>

<style scoped>
.threshold-cell {
  min-width: 0;
  padding: 0.75rem;
  border-width: 1px;
  border-style: solid;
  border-radius: var(--radius-control);
}

.threshold-cell dt {
  color: var(--ink-soft);
  font-size: 11px;
}

.threshold-cell dd {
  margin: 0.25rem 0 0;
  color: var(--ink);
  font-size: 12px;
  font-weight: 700;
}

th,
td {
  padding: 0.65rem 0.75rem;
  border: 1px solid var(--line);
  text-align: left;
  vertical-align: top;
}

th {
  background: var(--surface-2);
  color: var(--ink-soft);
}

code {
  color: var(--brand-deep);
  font-size: 11px;
}
</style>
