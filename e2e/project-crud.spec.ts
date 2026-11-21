import type { APIRequestContext, Page, TestInfo } from '@playwright/test'
import { Buffer } from 'node:buffer'
import { expect, test } from '@playwright/test'

// #293 新增/编辑与 #423 导入均使用中央命令；本套开发实例删除仍禁用。

test('项目列表：正式新增与中央导入可用', async ({ page }) => {
  const pageErrors: string[] = []
  page.on('pageerror', error => pageErrors.push(error.message))

  await page.goto('/project')
  const create = page.getByRole('button', { name: '新增项目', exact: true }).first()
  await expect(create).toBeVisible({ timeout: 15_000 })

  await expect(create).toBeEnabled()
  await expect(create).toHaveAttribute('title', '新增正式项目')
  await expect(page.getByRole('button', { name: '导入项目', exact: true }))
    .toBeEnabled()
  await expect(page.getByRole('button', { name: '导入项目', exact: true }))
    .toHaveAttribute('title', '导入项目（映射页签）')

  expect(pageErrors, '中央项目列表不应产生客户端运行错误').toEqual([])
})

function testSession(testInfo: TestInfo) {
  return Buffer.from(testInfo.testId, 'utf8').toString('base64url')
}

async function resetProjectBackend(
  request: APIRequestContext,
  sessionId: string,
) {
  const response = await request.post('/api/testing/projects/reset', {
    headers: {
      'x-ruihang-test-reset': '1',
      'x-ruihang-test-session': sessionId,
    },
    data: { scenario: 'ready' },
  })
  expect(response.ok()).toBe(true)
}

async function commandContext(page: Page) {
  return page.evaluate(async () => {
    const response = await fetch('/api/read/business-session')
    if (!response.ok)
      throw new Error(`business session failed: ${response.status}`)
    return await response.json() as {
      workspaceId: string
      actorId: string
    }
  })
}

async function createProjectByCommand(
  page: Page,
  commandId: string,
  name: string,
) {
  const context = await commandContext(page)
  return page.evaluate(async ({ context, commandId, name }) => {
    const response = await fetch('/api/commands/projects', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        ...context,
        requiredCapability: 'project:write',
        commandId,
        baseVersion: null,
        action: 'draft',
        draft: { name, manager: '张经理', status: '筹备中' },
        attachments: { add: [], removeIds: [], restoreIds: [] },
      }),
    })
    if (!response.ok)
      throw new Error(`project create failed: ${response.status}`)
    return await response.json() as { id: string, version: string, commandId: string }
  }, { context, commandId, name })
}

test.describe('Issue #293：项目中央命令与本地草稿', () => {
  test.beforeEach(async ({ page }, testInfo) => {
    const sessionId = testSession(testInfo)
    await page.setExtraHTTPHeaders({ 'x-ruihang-test-session': sessionId })
    await resetProjectBackend(page.context().request, sessionId)
  })

  test.afterEach(async ({ page }, testInfo) => {
    await resetProjectBackend(page.context().request, testSession(testInfo))
  })

  test('新建与编辑穿过表单、命令、读模型和详情，刷新后仍可见', async ({ page }) => {
    await page.goto('/project')
    const empty = page.getByRole('status', { name: '还没有施工项目' })
    await expect(empty)
      .toBeVisible({ timeout: 20_000 })
    await empty.getByRole('button', { name: '新增项目' }).click()
    await expect(page).toHaveURL(/\/project\/form$/)

    await page.getByLabel('项目名称 *').fill('中央新建项目')
    await page.getByLabel('项目经理 *').fill('张经理')
    await page.getByRole('button', { name: '保存草稿' }).click()
    await expect(page).toHaveURL(/\/project\/[A-Za-z0-9-]+\?origin=real$/)
    await expect(page.getByRole('heading', { name: '中央新建项目' })).toBeVisible()

    await page.reload()
    await expect(page.getByRole('heading', { name: '中央新建项目' })).toBeVisible()
    await page.getByRole('link', { name: '编辑项目' }).click()
    await page.getByLabel('项目名称 *').fill('中央编辑后项目')
    const updateResponse = page.waitForResponse(response =>
      response.url().includes('/api/commands/projects/')
      && response.request().method() === 'PUT',
    )
    await page.getByRole('button', { name: '保存草稿' }).click()
    expect((await updateResponse).ok()).toBe(true)
    const serverFormName = await page.evaluate(async () => {
      const id = location.pathname.split('/').filter(Boolean).at(-1)
      const response = await fetch(`/api/read/projects/${id}/form`)
      return (await response.json()).draft.name as string
    })
    expect(serverFormName).toBe('中央编辑后项目')
    await expect(page.getByRole('heading', { name: '中央编辑后项目' })).toBeVisible()

    await page.getByRole('link', { name: '返回项目列表' }).click()
    await expect(page.getByRole('link', { name: '中央编辑后项目', exact: true })).toBeVisible()
  })

  test('重放同一 commandId 返回同一 ID，不重复创建', async ({ page }) => {
    await page.goto('/project')
    const first = await createProjectByCommand(page, 'browser-idempotent-1', '幂等项目')
    const duplicate = await createProjectByCommand(page, 'browser-idempotent-1', '幂等项目')

    expect(duplicate).toEqual(first)
    const total = await page.evaluate(async () => {
      const response = await fetch('/api/read/projects?includeDemo=false&page=1&pageSize=10')
      return (await response.json()).pagination.total as number
    })
    expect(total).toBe(1)
  })

  test('过期 baseVersion 显示冲突，重读后由用户选择服务器最新版本', async ({ page }) => {
    await page.goto('/project')
    const created = await createProjectByCommand(page, 'browser-conflict-create', '冲突初始项目')
    await page.goto(`/project/form/${created.id}?origin=real`)
    await page.getByLabel('项目名称 *').fill('页面本地修改')

    const context = await commandContext(page)
    const updated = await page.evaluate(async ({ context, created }) => {
      const response = await fetch(`/api/commands/projects/${created.id}`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          ...context,
          id: created.id,
          requiredCapability: 'project:write',
          commandId: 'browser-conflict-winner',
          baseVersion: created.version,
          action: 'draft',
          draft: { id: created.id, name: '服务器最新项目', manager: '李经理', status: '施工中' },
          attachments: { add: [], removeIds: [], restoreIds: [] },
        }),
      })
      if (!response.ok)
        throw new Error(`project update failed: ${response.status}`)
      return await response.json() as { version: string }
    }, { context, created })
    expect(updated.version).toBe('2')

    await page.getByRole('button', { name: '保存草稿' }).click()
    const conflict = page.getByRole('alert')
    await expect(conflict).toContainText('项目已被其他操作更新')
    await expect(conflict).toContainText('服务器最新版本为 2')
    await page.getByRole('button', { name: '改用服务器最新版' }).click()
    await expect(page.getByLabel('项目名称 *')).toHaveValue('服务器最新项目')
  })

  test('服务完全不可达时只留本地 draftId，正式读模型不变且重载可恢复', async ({ page }) => {
    await page.goto('/project/form')
    await page.getByLabel('项目名称 *').fill('断网本地项目')
    await page.getByLabel('项目经理 *').fill('张经理')
    await page.route('**/api/read/business-session', route => route.abort('internetdisconnected'))
    await page.getByRole('button', { name: '保存草稿' }).click()

    await expect(page.getByRole('status')).toContainText('仅保留本地草稿，未正式保存')
    const localDraft = await page.evaluate(() => Object.keys(localStorage)
      .filter(key => key.startsWith('ruihang:project-local-draft:'))
      .map(key => localStorage.getItem(key)))
    expect(localDraft).toHaveLength(1)
    expect(localDraft[0]).toContain('project-draft-')
    expect(localDraft[0]).toContain('断网本地项目')
    const draftUrl = page.url()

    await page.unroute('**/api/read/business-session')
    const total = await page.evaluate(async () => {
      const response = await fetch('/api/read/projects?includeDemo=false&page=1&pageSize=10')
      return (await response.json()).pagination.total as number
    })
    expect(total).toBe(0)
    await page.reload()
    // 编辑表单不属于默认冷恢复页面；用持有的本地 draftId 显式重新进入。
    await page.goto(draftUrl)
    await expect(page.getByRole('status')).toContainText('已恢复上次仅保留在本地的草稿')
    await expect(page.getByLabel('项目名称 *')).toHaveValue('断网本地项目')
  })
})
