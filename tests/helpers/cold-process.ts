import type { ExecFileOptions, SpawnOptions } from 'node:child_process'
import type { ColdEntry } from '../global-setup'
import { execFile, spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import process from 'node:process'
import { promisify } from 'node:util'
import { inject } from 'vitest'

/**
 * 冷进程入口的预打包产物（tests/global-setup.ts 按源码内容键生成）。
 * 仍是独立 Node 进程、仍从磁盘打开数据库；预打包只省去每次启动时的 TS 转译，不共享任何内存状态。
 */
function bundle(entry: ColdEntry): string {
  const path = join(inject('coldBundleDirectory'), `${entry}.mjs`)
  if (!existsSync(path))
    throw new Error(`冷进程入口 ${entry} 未预打包；请在 tests/global-setup.ts 的 COLD_ENTRIES 登记`)
  return path
}

/** 运行一次冷进程到退出，返回 stdout/stderr；非零退出码按 execFile 语义抛错。 */
export function runColdProcess(entry: ColdEntry, args: readonly string[] = [], options: Omit<ExecFileOptions, 'encoding'> = {}): Promise<{ stdout: string, stderr: string }> {
  return promisify(execFile)(process.execPath, [bundle(entry), ...args], { windowsHide: true, cwd: resolve('.'), ...options, encoding: 'utf8' })
}

/** 启动常驻冷进程（如独立服务），由调用方负责停止。 */
export function spawnColdProcess(entry: ColdEntry, options: SpawnOptions = {}) {
  return spawn(process.execPath, [bundle(entry)], { windowsHide: true, cwd: resolve('.'), ...options })
}
