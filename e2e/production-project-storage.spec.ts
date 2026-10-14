import type { Page } from '@playwright/test'
import type { ChildProcess } from 'node:child_process'
import { Buffer } from 'node:buffer'
import { spawn } from 'node:child_process'
import { createHash, scryptSync } from 'node:crypto'
import { once } from 'node:events'
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { createServer } from 'node:net'
import { resolve } from 'node:path'
import process from 'node:process'
import { DatabaseSync } from 'node:sqlite'
import { expect, test } from '@playwright/test'
import * as XLSX from 'xlsx'

test.skip(process.env.CRM_PRODUCTION_ACCEPTANCE !== '1', '需先构建，再在专属合成目录运行本机验收；不连接开发或用户数据')
test.use({ actionTimeout: 15_000, navigationTimeout: 30_000 })
test('公开项目保存、原件、Excel 回执与客户关联跨独立进程重启', async ({ page }, testInfo) => {
  test.setTimeout(180_000)
  const root = resolve('.')
  const base = resolve('.tmp/a01-a03-production/project')
  await mkdir(base, { recursive: true })
  const directory = await mkdtemp(`${base}/synthetic-`)
  const portProbe = createServer().listen(0, '127.0.0.1')
  await once(portProbe, 'listening')
  const port = (portProbe.address() as { port: number }).port
  await new Promise<void>(resolve => portProbe.close(() => resolve()))
  const origin = `http://127.0.0.1:${port}`
  const code = 'customer-synthetic-access-only'
  const salt = '0123456789abcdef0123456789abcdef'
  const hash = `scrypt$${salt}$${scryptSync(code, Buffer.from(salt, 'hex'), 64).toString('hex')}`
  let child: ChildProcess | null = null
  let logs = ''
  const pageErrors: string[] = []
  page.on('pageerror', error => pageErrors.push(error.message))
  page.on('dialog', dialog => void dialog.accept())
  async function stop() {
    if (child && child.exitCode === null) {
      const exited = once(child, 'exit')
      child.kill()
      await exited
    }
    child = null
  }
  async function start() {
    child = spawn(process.execPath, ['.output/server/index.mjs'], {
      cwd: root,
      windowsHide: true,
      env: { ...process.env, NODE_ENV: 'production', CRM_RUN_MODE: 'production', CRM_DATA_DIRECTORY: directory, CRM_WORKSPACE_ID: 'browser-verification', CRM_OWNER_ID: 'verification-owner', CRM_DATA_PURPOSE: 'verification', CRM_PUBLIC_ORIGIN: origin, CRM_ACCESS_CODE_HASH: hash, NITRO_HOST: '127.0.0.1', NITRO_PORT: String(port), PORT: String(port) },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    child.stdout!.on('data', data => logs += String(data))
    child.stderr!.on('data', data => logs += String(data))
    await expect.poll(async () => {
      if (child?.exitCode !== null)
        throw new Error(logs)
      try {
        return (await fetch(`${origin}/api/auth/status`)).status
      }
      catch { return 0 }
    }, { timeout: 30_000 }).toBe(200)
  }
  async function login(target: Page) {
    await expect(target.getByLabel('本机访问码')).toBeVisible()
    await target.getByLabel('本机访问码').fill(code)
    await target.getByLabel('本机访问码').press('Tab')
    await expect(target.getByRole('button', { name: '进入工作区', exact: true })).toBeFocused()
    await target.keyboard.press('Enter')
    await expect(target.getByRole('button', { name: '退出本机登录' })).toBeVisible()
    await expect(target).toHaveURL(`${origin}/base/customer`)
  }
  async function request(path: string, options?: { method?: string, data?: unknown }) {
    return page.request.fetch(`${origin}${path}`, { ...options, headers: { Origin: origin } })
  }
  async function importExcel(file: { name: string, mimeType: string, buffer: Buffer }) {
    await page.goto(`${origin}/import/mapping/project`)
    await page.getByLabel('选择导入文件').setInputFiles(file)
    await page.getByRole('button', { name: '使用此工作表', exact: true }).click()
    await page.getByRole('button', { name: '下一步', exact: true }).click()
    await expect(page.getByRole('region', { name: '客户身份与阶段核对表' })).toBeVisible()
    await page.getByRole('button', { name: '开始导入', exact: true }).click()
    await expect(page).toHaveURL(`${origin}/project`)
    await expect(page.getByRole('link', { name: '磁盘 Excel 项目', exact: true })).toBeVisible()
  }
  try {
    await start()
    await page.goto(`${origin}/project/form`)
    await login(page)
    const customerResponse = await request('/api/commands/customers', { method: 'POST', data: { commandId: 'project-browser-customer', workspaceId: 'browser-verification', actorId: 'verification-owner', requiredCapability: 'customer:write', baseVersion: null, action: 'save', draft: { name: '项目关联客户', contact: '合成人' }, attachments: {} } })
    expect(customerResponse.status()).toBe(200)
    const customer = await customerResponse.json()
    await page.goto(`${origin}/project/form`)
    await page.getByLabel('项目名称 *').fill('项目磁盘重启验收')
    await page.getByLabel('项目经理 *').fill('合成项目经理')
    await page.getByRole('combobox', { name: '检索客户', exact: true }).click()
    await page.getByRole('option', { name: '项目关联客户' }).click()
    const bytes = Buffer.from('项目原件的真实字节，重启后不得重建。')
    await page.locator('input[type=file]').setInputFiles({ name: '项目原件.txt', mimeType: 'text/plain', buffer: bytes })
    await expect(page.getByText('项目原件.txt', { exact: true })).toBeVisible()
    let saved: { id: string, commandId: string, version: string, attachmentIds: string[] } | null = null
    await page.route('**/api/commands/projects', async (route) => {
      const response = await route.fetch()
      expect(response.status(), await response.text()).toBe(200)
      saved = await response.json()
      await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ message: 'synthetic-response-lost-after-commit' }) })
    }, { times: 1 })
    await page.getByRole('button', { name: '保存并提交', exact: true }).click()
    await expect.poll(() => saved?.id).toBeTruthy()
    expect(await page.evaluate(() => JSON.stringify({ session: { ...sessionStorage }, local: { ...localStorage } }))).not.toContain(bytes.toString('base64'))
    await stop()
    await start()
    await page.reload()
    await login(page)
    await page.goto(`${origin}/project`)
    await page.getByRole('link', { name: '核对项目提交 1' }).click()
    await expect(page.getByLabel('项目名称 *')).toHaveValue('项目磁盘重启验收')
    await expect(page.getByText('已核对上次提交：保存成功，现已读取磁盘中的项目。')).toBeVisible()
    const id = saved!.id
    for (const width of [390, 768, 1024, 1280, 1440]) {
      await page.setViewportSize({ width, height: 900 })
      await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth && (!document.querySelector('.shell-workspace') || document.querySelector('.shell-workspace')!.scrollWidth <= document.querySelector('.shell-workspace')!.clientWidth))).toBe(true)
    }
    const downloadPromise = page.waitForEvent('download')
    await page.getByRole('button', { name: '下载原件 项目原件.txt' }).click()
    const downloaded = await downloadPromise
    const output = testInfo.outputPath('downloaded-original.txt')
    await downloaded.saveAs(output)
    expect(await readFile(output)).toEqual(bytes)
    const original = await request(`/api/read/projects/${id}/files/${saved!.attachmentIds[0]}`)
    expect(original.headers()['x-content-sha256']).toBe(createHash('sha256').update(bytes).digest('hex'))
    const form = await (await request(`/api/read/projects/${id}/form`)).json()
    expect(form).toMatchObject({ version: '1', draft: { id, customerId: customer.id } })
    const related = await (await request(`/api/read/customers/${customer.id}?origin=real`)).json()
    expect(related.projects).toHaveLength(1)
    expect(related.projects[0].project.id).toBe(id)
    await page.goto(`${origin}/project`)
    await page.getByRole('link', { name: '项目磁盘重启验收', exact: true }).click()
    await expect(page.getByRole('heading', { name: '项目磁盘重启验收', exact: true })).toBeVisible()
    await page.getByRole('button', { name: '删除项目', exact: true }).click()
    await page.getByRole('dialog').getByRole('button', { name: '取消', exact: true }).click()
    await expect(page.getByRole('button', { name: '删除项目', exact: true })).toBeFocused()
    await page.getByRole('button', { name: '删除项目', exact: true }).click()
    await page.getByRole('dialog').getByRole('button', { name: '删除项目', exact: true }).click()
    await expect(page.getByRole('button', { name: '恢复项目', exact: true })).toBeEnabled()
    await expect(page.getByText('项目已删除；恢复后可继续编辑和下载原件。', { exact: true })).toBeVisible()
    await expect(page.getByRole('link', { name: '编辑项目' })).toHaveCount(0)
    await page.getByRole('link', { name: '返回项目列表' }).click()
    await page.getByText('已删除项目（1）', { exact: true }).click()
    await expect(page.getByRole('link', { name: '项目磁盘重启验收', exact: true })).toHaveCount(1)
    await page.getByRole('group').getByRole('link', { name: '项目磁盘重启验收', exact: true }).click()
    await page.getByRole('button', { name: '恢复项目', exact: true }).click()
    await page.getByRole('dialog').getByRole('button', { name: '恢复项目', exact: true }).click()
    await expect(page.getByRole('link', { name: '编辑项目' })).toBeVisible()
    await page.getByRole('link', { name: '返回项目列表' }).click()
    await expect(page.getByText('已删除项目（0）', { exact: true })).toBeVisible()
    await expect(page.getByRole('link', { name: '项目磁盘重启验收', exact: true })).toHaveCount(1)
    expect(await (await request(`/api/read/projects/${id}/files/${saved!.attachmentIds[0]}`)).body()).toEqual(bytes)
    const book = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([['项目名称', '客户', '项目经理', '外部旧ID'], ['磁盘 Excel 项目', customer.id, '导入经理', '0007']]), '项目导入')
    const file = { name: '项目正式导入.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', buffer: Buffer.from(XLSX.write(book, { type: 'array', bookType: 'xlsx' })) }
    await importExcel(file)
    const firstRows = await (await request('/api/read/projects?pageSize=100')).json()
    expect(firstRows.pagination.total).toBe(2)
    const importedId = firstRows.items.find((row: { project: { label: string } }) => row.project.label === '磁盘 Excel 项目').project.id
    await stop()
    await start()
    await page.reload()
    await login(page)
    await importExcel(file)
    expect((await (await request('/api/read/projects?pageSize=100')).json()).pagination.total).toBe(2)
    expect(await (await request(`/api/read/projects/${importedId}/form`)).json()).toMatchObject({ draft: { id: importedId, customerId: customer.id }, importSource: { externalRef: '0007', rawSnapshot: { 外部旧ID: '0007' } } })
    expect((await request('/api/testing/projects/reset', { method: 'POST', data: {} })).status()).toBe(503)
    expect(pageErrors).toEqual([])
    await stop()
    const db = new DatabaseSync(resolve(directory, 'ruihang.sqlite'), { readOnly: true })
    expect(db.prepare('SELECT COUNT(*) n FROM projects').get()?.n).toBe(2)
    expect(db.prepare('SELECT COUNT(*) n FROM project_import_receipts').get()?.n).toBe(1)
    db.close()
  }
  finally {
    await stop()
    await writeFile(resolve(directory, 'service.log'), logs)
    await writeFile(resolve(directory, 'verification.json'), JSON.stringify({ pageErrors, directory, origin }, null, 2))
  }
})
