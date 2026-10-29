import type { Page } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { expect } from '@playwright/test'

/** Explicit test evidence belongs to the same isolated development SQL owner as the form. */
export async function createVerifiedSignatory(page: Page, name: string, sessionId?: string) {
  const headers = sessionId ? { 'x-ruihang-test-session': sessionId } : undefined
  const sessionResponse = await page.request.get('/api/read/business-session', { headers })
  expect(sessionResponse.ok(), await sessionResponse.text()).toBe(true)
  const { workspaceId, actorId } = await sessionResponse.json()
  const response = await page.request.post('/api/commands/our-signatories', { ...(sessionId ? { headers: { 'x-ruihang-test-session': sessionId } } : {}), data: {
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

export async function selectVerifiedSignatory(page: Page, _id: string, name: string) {
  const field = page.getByTestId('contract-our-signatory').getByRole('combobox')
  await expect(field).toBeEnabled()
  await field.fill(name)
  await page.getByRole('option', { name, exact: true }).click()
  await expect(page.getByTestId('contract-our-signatory-snapshot')).toHaveText(`文书采用：${name} · 核实版本 1`)
}

export async function verifiedSignatoryAdoption(page: Page, id: string, sessionId?: string) {
  const response = await page.request.get('/api/read/our-signatories', sessionId ? { headers: { 'x-ruihang-test-session': sessionId } } : {})
  expect(response.ok(), await response.text()).toBe(true)
  const data = await response.json()
  const row = data.records.find((record: { id: string }) => record.id === id)
  expect(row?.draft.status).toBe('active')
  expect(row?.version).toBe('1')
  const { status: _status, ...facts } = row.draft
  return { ourSignatoryId: id, ourSignatoryVersion: row.version as string, ourSignatorySnapshot: { id, version: row.version as string, ...facts } }
}
