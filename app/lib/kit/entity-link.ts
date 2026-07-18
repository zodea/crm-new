// 穿透件·实体蓝链纯逻辑（specs §07 / CONTEXT.md「穿透」词条）。
// type→route 映射唯一处：只登记已实装详情页，未实装类型自动退化纯文本——
// 实装后在此回填映射即全站上线，别处不复制路由。

export type EntityLinkType
  = | 'project'
    | 'supplier'
    | 'contract'
    | 'invoice'
    | 'customer'
    | 'crew'
    | 'worker'

export type EntityLinkResolution
  = | { kind: 'link', to: string, text: string }
    | { kind: 'text', text: string }
    | { kind: 'empty' }

export const ENTITY_ROUTES: Partial<Record<EntityLinkType, (id: string) => string>> = {
  project: id => `/project/${id}`,
  supplier: id => `/base/supplier/${id}`,
  contract: id => `/contract/${id}`,
  invoice: id => `/finance/invoice/${id}`,
}

export function resolveEntityLink(input: {
  type: EntityLinkType
  id?: string | null
  label?: string | null
}): EntityLinkResolution {
  const text = input.label ?? null
  if (text == null || text === '')
    return { kind: 'empty' }
  const route = ENTITY_ROUTES[input.type]
  if (!route || input.id == null || input.id === '')
    return { kind: 'text', text }
  return { kind: 'link', to: route(input.id), text }
}
