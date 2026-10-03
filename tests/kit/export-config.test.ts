import { describe, expect, it } from 'vitest'
import {
  buildConfiguredExportFiles,
  createExportStepper,
  renderNamePreview,
  resolveTwoLevelFolderPath,
  transitionExportStepper,
} from '~/lib/kit/export'

describe('配置导出：命名规则预览', () => {
  it('按已选字段顺序拼接预览文件名', () => {
    expect(renderNamePreview({
      parts: [
        { field: 'invoiceNumber', takeLast: 8 },
        { field: 'supplierShortName' },
        { field: 'invoiceDate' },
      ],
      separator: '_',
      extension: 'pdf',
    }, {
      invoiceNumber: '04400230011123456789',
      supplierShortName: '华东建材',
      invoiceDate: '2026-07-14',
    })).toBe('23456789_华东建材_2026-07-14.pdf')
  })

  it('空字段使用规则回退值并清理首尾空白', () => {
    expect(renderNamePreview({
      parts: [
        { field: 'projectName', fallback: '未归属项目' },
        { field: 'supplierShortName' },
      ],
      separator: '_',
    }, {
      projectName: null,
      supplierShortName: '  华东建材  ',
    })).toBe('未归属项目_华东建材')
  })

  it.each([
    { case: '{ parts: [{ field: \'supplierShortName\' }], extension: \'.pdf\', } / { supplierShortName: \'../华东:建材\', }', input: {
      parts: [{ field: 'supplierShortName' }],
      extension: '.pdf',
    }, argument2: {
      supplierShortName: '../华东:建材',
    }, expected: '-华东-建材.pdf' },
    { case: '{ parts: [{ field: \'supplierShortName\' }], extension: \'pdf\', } / { supplierShortName: \'CON\', }', input: {
      parts: [{ field: 'supplierShortName' }],
      extension: 'pdf',
    }, argument2: {
      supplierShortName: 'CON',
    }, expected: '_CON.pdf' },
    { case: '{ parts: [{ field: \'supplierShortName\' }], extension: \'pdf\', } / { supplierShortName: \'COM¹\', }', input: {
      parts: [{ field: 'supplierShortName' }],
      extension: 'pdf',
    }, argument2: {
      supplierShortName: 'COM¹',
    }, expected: '_COM¹.pdf' },
    { case: '{ parts: [{ field: \'projectName\' }], extension: \'pdf\', } / { projectName: \'项\'.repeat(256), }', input: {
      parts: [{ field: 'projectName' }],
      extension: 'pdf',
    }, argument2: {
      projectName: '项'.repeat(256),
    }, expected: `${'项'.repeat(251)}.pdf` },
    { case: '{ parts: [{ field: \'projectName\' }], extension: \'x\'.repeat(251), } / { projectName: \'CONTRACT\', }', input: {
      parts: [{ field: 'projectName' }],
      extension: 'x'.repeat(251),
    }, argument2: {
      projectName: 'CONTRACT',
    }, expected: `_CO.${'x'.repeat(251)}` },
  ])('预览即为可写盘的安全文件名 / renderNamePreview：$case', ({ input, argument2, expected }) => {
    expect(renderNamePreview(input, argument2)).toBe(expected)
  })

  it('后 N 位按码点截取，不劈开星平面字符', () => {
    expect(renderNamePreview({
      parts: [{ field: 'supplierShortName', takeLast: 2 }],
    }, {
      supplierShortName: '建材𠮷',
    })).toBe('材𠮷')
  })

  it('发票号后 N 位只接受正整数', () => {
    expect(() => renderNamePreview({
      parts: [{ field: 'invoiceNumber', takeLast: 0 }],
    }, {
      invoiceNumber: '04400230011123456789',
    })).toThrowError('命名规则的后 N 位必须是正整数')
  })
})

describe('配置导出：生成相对写盘计划', () => {
  it('按两级目录与命名规则生成可写相对路径', () => {
    const files = buildConfiguredExportFiles({
      source: {
        label: '采购合同',
        fields: [
          { key: 'projectName', label: '项目' },
          { key: 'supplierName', label: '分供方' },
          { key: 'contractNo', label: '合同号' },
        ],
        files: [{
          row: {
            projectName: '滨江壹号',
            supplierName: '华东建材',
            contractNo: 'CG-2026-001',
          },
          data: '合同正文',
          mimeType: 'text/plain',
        }],
      },
      structure: {
        levels: [{ field: 'projectName' }, { field: 'supplierName' }],
      },
      naming: {
        parts: [{ field: 'supplierName' }, { field: 'contractNo' }],
        separator: '_',
        extension: 'txt',
      },
    })

    expect(files).toEqual([{
      relativePath: '滨江壹号/华东建材/华东建材_CG-2026-001.txt',
      data: '合同正文',
      mimeType: 'text/plain',
    }])
  })

  it('同目录同名文件追加稳定序号，避免静默覆盖', () => {
    const source = {
      label: '采购合同',
      fields: [{ key: 'supplierName', label: '分供方' }],
      files: [
        { row: { supplierName: '华东建材' }, data: '第一份' },
        { row: { supplierName: '华东建材' }, data: '第二份' },
      ],
    }

    expect(buildConfiguredExportFiles({
      source,
      structure: { levels: [] },
      naming: {
        parts: [{ field: 'supplierName' }],
        extension: 'txt',
      },
    }).map(file => file.relativePath)).toEqual([
      '华东建材.txt',
      '华东建材 (2).txt',
    ])
  })

  it('按 Windows 等价规则处理大小写与 Unicode 规范化碰撞', () => {
    const source = {
      label: '采购合同',
      fields: [{ key: 'contractName', label: '合同名' }],
      files: [
        { row: { contractName: '合同A' }, data: '第一份' },
        { row: { contractName: '合同a' }, data: '第二份' },
        { row: { contractName: 'Café' }, data: '第三份' },
        { row: { contractName: 'Cafe\u0301' }, data: '第四份' },
      ],
    }

    expect(buildConfiguredExportFiles({
      source,
      structure: { levels: [] },
      naming: {
        parts: [{ field: 'contractName' }],
        extension: 'txt',
      },
    }).map(file => file.relativePath)).toEqual([
      '合同A.txt',
      '合同a (2).txt',
      'Café.txt',
      'Café (2).txt',
    ])
  })
})

describe('配置导出：两级目录结构', () => {
  it('按配置顺序把行数据解析为目录段', () => {
    expect(resolveTwoLevelFolderPath({
      levels: [
        { field: 'projectName' },
        { field: 'supplierShortName' },
      ],
    }, {
      projectName: '滨江壹号',
      supplierShortName: '华东建材',
    })).toEqual(['滨江壹号', '华东建材'])
  })

  it('拒绝超过两级的目录配置', () => {
    expect(() => resolveTwoLevelFolderPath({
      levels: [
        { field: 'projectName' },
        { field: 'supplierShortName' },
        { field: 'invoiceMonth' },
      ],
    }, {})).toThrowError('导出目录结构最多支持两级')
  })

  describe('把目录穿越、绝对路径和 Windows 非法名称清理成安全目录段', () => {
    const config = {
      levels: [
        { field: 'projectName' },
        { field: 'supplierShortName' },
      ],
    }
    it.each([
      { case: 'config / { projectName: \'..\', supplierShortName: \'C:\\\\合同/原件:*?\', }', input: config, argument2: {
        projectName: '..',
        supplierShortName: 'C:\\合同/原件:*?',
      }, expected: ['未分类', 'C-合同-原件-'] },
      { case: 'config / { projectName: \'滨江壹号\', supplierShortName: \'CON\', }', input: config, argument2: {
        projectName: '滨江壹号',
        supplierShortName: 'CON',
      }, expected: ['滨江壹号', '_CON'] },
    ])('resolveTwoLevelFolderPath：$case', ({ input, argument2, expected }) => {
      expect(resolveTwoLevelFolderPath(structuredClone(input), structuredClone(argument2))).toEqual(expected)
    })
  })

  it.each([
    { case: '{ levels: [{ field: \'projectName\', fallback: \'..\' }], } / {}', input: {
      levels: [{ field: 'projectName', fallback: '..' }],
    }, argument2: {}, expected: ['未分类'] },
    { case: '{ levels: [{ field: \'projectName\' }, { field: \'supplierShortName\' }], } / { projectName: \'项\'.repeat(256), supplierShortName: ', input: {
      levels: [{ field: 'projectName' }, { field: 'supplierShortName' }],
    }, argument2: {
      projectName: '项'.repeat(256),
      supplierShortName: 'LPT³.txt',
    }, expected: ['项'.repeat(255), '_LPT³.txt'] },
  ])('把目录穿越、绝对路径和 Windows 非法名称清理成安全目录段 / resolveTwoLevelFolderPath：$case', ({ input, argument2, expected }) => {
    expect(resolveTwoLevelFolderPath(input, argument2)).toEqual(expected)
  })

  it('长度截断后仍移除 Windows 禁止的尾随点与空格', () => {
    const valueEndingWithDotAtLimit = `${'甲'.repeat(254)}.尾`
    const valueEndingWithSpaceAtLimit = `${'乙'.repeat(254)} 尾`

    const [dotPath] = resolveTwoLevelFolderPath({
      levels: [{ field: 'folder' }],
    }, { folder: valueEndingWithDotAtLimit })
    const [spacePath] = resolveTwoLevelFolderPath({
      levels: [{ field: 'folder' }],
    }, { folder: valueEndingWithSpaceAtLimit })
    const fileName = renderNamePreview({
      parts: [{ field: 'name' }],
    }, { name: valueEndingWithDotAtLimit })

    expect(dotPath).toHaveLength(254)
    expect(spacePath).toHaveLength(254)
    expect(fileName).toHaveLength(254)
    expect(dotPath).not.toMatch(/[. ]$/)
    expect(spacePath).not.toMatch(/[. ]$/)
    expect(fileName).not.toMatch(/[. ]$/)
  })
})

describe('配置导出：三步进度状态机', () => {
  it('从待开始进入读数据步骤，且不修改旧状态', () => {
    const initial = createExportStepper()
    const started = transitionExportStepper(initial, { type: 'start' })

    expect(initial).toEqual({
      phase: 'idle',
      steps: [
        { id: 'read-data', label: '读数据', status: 'pending' },
        { id: 'generate-files', label: '生成', status: 'pending' },
        { id: 'write-disk', label: '写盘', status: 'pending' },
      ],
    })
    expect(started).toEqual({
      phase: 'running',
      steps: [
        { id: 'read-data', label: '读数据', status: 'active' },
        { id: 'generate-files', label: '生成', status: 'pending' },
        { id: 'write-disk', label: '写盘', status: 'pending' },
      ],
    })
  })

  it('完成当前步骤后打勾并激活下一步', () => {
    const started = transitionExportStepper(createExportStepper(), { type: 'start' })
    const generated = transitionExportStepper(started, { type: 'complete' })

    expect(generated).toMatchObject({
      phase: 'running',
      steps: [
        { id: 'read-data', status: 'completed' },
        { id: 'generate-files', status: 'active' },
        { id: 'write-disk', status: 'pending' },
      ],
    })
  })

  it('失败时标记当前步，重试从失败步继续直至全部完成', () => {
    const started = transitionExportStepper(createExportStepper(), { type: 'start' })
    const generating = transitionExportStepper(started, { type: 'complete' })
    const failed = transitionExportStepper(generating, { type: 'fail' })

    expect(failed).toMatchObject({
      phase: 'failed',
      steps: [
        { id: 'read-data', status: 'completed' },
        { id: 'generate-files', status: 'failed' },
        { id: 'write-disk', status: 'pending' },
      ],
    })

    const retried = transitionExportStepper(failed, { type: 'retry' })
    expect(retried).toMatchObject({
      phase: 'running',
      steps: [
        { id: 'read-data', status: 'completed' },
        { id: 'generate-files', status: 'active' },
        { id: 'write-disk', status: 'pending' },
      ],
    })

    const writing = transitionExportStepper(retried, { type: 'complete' })
    const completed = transitionExportStepper(writing, { type: 'complete' })
    expect(completed).toMatchObject({
      phase: 'completed',
      steps: [
        { id: 'read-data', status: 'completed' },
        { id: 'generate-files', status: 'completed' },
        { id: 'write-disk', status: 'completed' },
      ],
    })
  })
})
