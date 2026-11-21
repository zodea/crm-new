import { execFileSync } from 'node:child_process'
import process from 'node:process'

// 正式验收自行启动随机端口的子进程，只需为本轮准备同一份正式构建。
export default function buildApplication() {
  execFileSync(process.execPath, ['./node_modules/nuxt/bin/nuxt.mjs', 'build'], {
    env: { ...process.env, NUXT_DEVTOOLS: 'false', NUXT_PUBLIC_VISUAL_BASELINE_MODE: '' },
    stdio: 'inherit',
  })
}
