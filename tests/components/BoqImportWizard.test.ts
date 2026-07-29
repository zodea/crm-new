import { render, screen } from '@testing-library/vue'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { computed, ref, shallowRef, useTemplateRef } from 'vue'
import BoqImportWizard from '~/components/boq/BoqImportWizard.vue'
import ProcessStepper from '~/components/ui/ProcessStepper.vue'
import ProgressBar from '~/components/ui/ProgressBar.vue'

describe('boqImportWizard', () => {
  beforeAll(() => {
    vi.stubGlobal('computed', computed)
    vi.stubGlobal('ref', ref)
    vi.stubGlobal('shallowRef', shallowRef)
    vi.stubGlobal('useTemplateRef', useTemplateRef)
    vi.stubGlobal('useKitUI', () => ({
      error: vi.fn(),
    }))
  })

  afterAll(() => {
    vi.unstubAllGlobals()
  })

  it('keeps processing progress at zero until a file is selected', () => {
    render(BoqImportWizard, {
      props: {
        projectId: 'project-1',
        contractId: 'contract-1',
      },
      global: {
        components: {
          ProcessStepper,
          ProgressBar,
        },
        stubs: {
          KitTable: true,
          SelectFilter: true,
        },
      },
    })

    const progress = screen.getByRole('progressbar', { name: '处理进度' })
    expect(progress.getAttribute('aria-valuenow')).toBe('0')
    expect(progress.getAttribute('aria-valuetext')).toContain('已完成 0/3 步')
    expect(screen.getByText('0%')).not.toBeNull()
  })
})
