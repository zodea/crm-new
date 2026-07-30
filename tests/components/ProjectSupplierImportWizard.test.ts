import { fireEvent, render, screen, waitFor } from '@testing-library/vue'
import { describe, expect, it } from 'vitest'
import { defineComponent } from 'vue'
import ProjectSupplierImportWizard from '~/components/project-supplier/ProjectSupplierImportWizard.vue'

const global = {
  components: {
    ProcessStepper: defineComponent({
      props: ['steps'],
      template: '<ol aria-label="处理步骤"><li v-for="step in steps" :key="step.id">{{ step.label }} {{ step.status }}</li></ol>',
    }),
    StatePanel: defineComponent({
      props: ['title'],
      template: '<div>{{ title }}</div>',
    }),
  },
}

function renderWizard(existingSupplierIds = new Set<string>()) {
  return render(ProjectSupplierImportWizard, {
    props: {
      projectName: '合和新城',
      suppliers: [
        {
          id: 'supplier-1',
          name: '广州市大板东建材有限公司',
          aliases: ['大板东'],
        },
      ],
      existingSupplierIds,
    },
    global,
  })
}

async function chooseFile(file: File) {
  const input = document.querySelector<HTMLInputElement>('input[type="file"]')
  if (!input)
    throw new Error('未找到文件选择器')
  await fireEvent.change(input, { target: { files: [file] } })
}

describe('project supplier import wizard', () => {
  it('按文件名匹配已有分供方，标记复用关系并回传分类结果', async () => {
    const { emitted } = renderWizard(new Set(['supplier-1']))
    const file = new File(['contract'], '大板东-施工合同.pdf', { type: 'application/pdf' })
    await chooseFile(file)

    await waitFor(() => expect(screen.getByText('大板东-施工合同.pdf')).not.toBeNull())
    await fireEvent.click(screen.getByRole('button', { name: '下一步：自动分类' }))

    const supplierSelect = screen.getByRole('combobox', { name: '大板东-施工合同.pdf 分供方' }) as HTMLSelectElement
    expect(supplierSelect.value).toBe('supplier-1')
    expect(screen.getByText('已有项目关系，只追加文件')).not.toBeNull()

    await fireEvent.click(screen.getByRole('button', { name: '下一步：确认生成' }))
    expect(screen.getByText('复用已有关系')).not.toBeNull()
    await fireEvent.click(screen.getByRole('button', { name: '确认生成并返回项目' }))

    const payload = emitted().confirm?.[0]?.[0] as Array<{
      file: File
      supplierId: string
      category: string
    }>
    expect(payload).toHaveLength(1)
    expect(payload[0]).toMatchObject({
      file,
      supplierId: 'supplier-1',
      category: '合同',
    })
  })

  it('未匹配文件必须明确确认新建分供方后才能进入最终确认', async () => {
    const { emitted } = renderWizard()
    await chooseFile(new File(['payment'], '合和新城-南方机电-付款回单.pdf', { type: 'application/pdf' }))
    await fireEvent.click(screen.getByRole('button', { name: '下一步：自动分类' }))

    const next = screen.getByRole('button', { name: '下一步：确认生成' }) as HTMLButtonElement
    expect(next.disabled).toBe(true)
    expect((screen.getByRole('textbox', { name: /新分供方名称/ }) as HTMLInputElement).value).toBe('南方机电')

    await fireEvent.click(screen.getByRole('checkbox', { name: '确认新建 南方机电' }))
    expect(next.disabled).toBe(false)
    await fireEvent.click(next)
    expect(screen.getByText('新建主数据')).not.toBeNull()
    await fireEvent.click(screen.getByRole('button', { name: '确认生成并返回项目' }))

    const payload = emitted().confirm?.[0]?.[0] as Array<{
      supplierId: string
      supplierName: string
      createSupplierConfirmed: boolean
      category: string
    }>
    expect(payload[0]).toMatchObject({
      supplierId: '',
      supplierName: '南方机电',
      createSupplierConfirmed: true,
      category: '付款',
    })
  })
})
