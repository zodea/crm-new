import type { APIRequestContext, Page } from '@playwright/test'
import type { OurSignatoryListDTO } from '../../app/lib/our-signatory/contract'
import { randomUUID } from 'node:crypto'
import { expect } from '@playwright/test'
import { signatorySnapshot } from '../../app/lib/our-signatory/contract'

/** Explicit test evidence belongs to the same isolated development SQL owner as the form. */
export async function createVerifiedSignatory(target: Page | APIRequestContext, name: string, sessionId?: string) {
  const request = 'request' in target ? target.request : target
  const headers = sessionId ? { 'x-ruihang-test-session': sessionId } : undefined
  const sessionResponse = await request.get('/api/read/business-session', { headers })
  expect(sessionResponse.ok(), await sessionResponse.text()).toBe(true)
  const { workspaceId, actorId } = await sessionResponse.json()
  const response = await request.post('/api/commands/our-signatories', { headers, data: {
    workspaceId,
    actorId,
    requiredCapability: 'our-signatory:write',
    commandId: randomUUID(),
    baseVersion: null,
    draft: { name, taxNo: null, registeredAddress: null, legalRepresentative: null, verificationNote: '此独立验收用例已核实的合成文书主体', status: 'active' },
  } })
  expect(response.ok(), await response.text()).toBe(true)
  const result = await response.json()
  expect(result.id).toEqual(expect.any(String))
  expect(result.version).toBe('1')
  return result.id as string
}

export async function selectVerifiedSignatory(page: Page, id: string, name: string, taxNo?: string | null) {
  const field = page.getByRole('combobox', { name: '搜索已核实的签约主体', exact: true })
  await expect(field).toBeEnabled()
  await field.click()
  await field.fill(id)
  await page.getByRole('option', { name: taxNo ? `${name} ${taxNo}` : name, exact: true }).click()
  await expect(page.getByTestId('contract-our-signatory-snapshot')).toHaveText(`文书采用：${name} · 核实版本 1${taxNo ? ` · 税号 ${taxNo}` : ''}`)
}

export async function verifiedSignatoryAdoption(target: Page | APIRequestContext, id: string, sessionId?: string) {
  const request = 'request' in target ? target.request : target
  const response = await request.get('/api/read/our-signatories', sessionId ? { headers: { 'x-ruihang-test-session': sessionId } } : {})
  expect(response.ok(), await response.text()).toBe(true)
  const data: OurSignatoryListDTO = await response.json()
  const row = data.records.find(record => record.id === id)
  expect(row?.draft.status).toBe('active')
  expect(row?.version).toBe('1')
  return { ourSignatoryId: id, ourSignatoryVersion: row!.version, ourSignatorySnapshot: signatorySnapshot(row!) }
}
