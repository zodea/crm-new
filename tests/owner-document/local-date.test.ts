import { describe, expect, it } from 'vitest'
import { ownerDocumentLocalDate } from '~/lib/owner-document/page'

describe('甲方商务单据本地业务日期', () => {
  it('使用本地年月日，不在中国时区凌晨回退到 UTC 前一天', () => {
    const chinaMidnight = {
      getFullYear: () => 2026,
      getMonth: () => 7,
      getDate: () => 25,
    }

    expect(ownerDocumentLocalDate(chinaMidnight)).toBe('2026-08-25')
  })
})
