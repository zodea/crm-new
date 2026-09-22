/** 工人主档保留原表全文；文件只读取已存正文，绝不从历史路径打开本机文件。 */
export const WORKER_ROSTER_SOURCE_SQL = `SELECT w.*,
  COALESCE((SELECT json_group_array(json_object(
    'id', f.id, 'ownerType', f.owner_type, 'ownerId', f.owner_id,
    'fileName', f.file_name, 'filePath', f.file_path, 'fileSize', f.file_size,
    'mimeType', f.mime_type, 'category', f.category, 'uploader', f.uploader,
    'uploadedAt', f.uploaded_at, 'deletedAt', f.deleted_at,
    'payloadEncoding', p.encoding, 'payloadContent', p.content
  )) FROM (SELECT * FROM file_refs WHERE owner_type='worker' AND owner_id=w.id ORDER BY id) f
  LEFT JOIN file_payloads p ON p.file_ref_id=f.id), '[]') AS worker_files_json
  FROM workers w ORDER BY w.id`

const FIELDS = {
  gender: 'gender',
  idCard: 'id_card',
  phone: 'phone',
  hometown: 'hometown',
  emergencyContact: 'emergency_contact',
  emergencyPhone: 'emergency_phone',
  trade: 'trade',
  capabilityTrades: 'trade_capabilities',
  capabilityItems: 'item_capabilities',
  skillLevel: 'skill_level',
  projectStatus: 'project_status',
  entryDate: 'entry_date',
  exitDate: 'exit_date',
  bankName: 'bank_name',
  bankAccount: 'bank_account',
  bankCode: 'bank_code',
  note: 'note',
  status: 'status',
  createdAt: 'created_at',
  updatedAt: 'updated_at',
} as const

export const WORKER_ROSTER_SOURCE_ATTRIBUTE_KEYS = [...Object.keys(FIELDS), 'safetyEducation', 'workerOriginalJson', 'workerFilesJson']

export function workerRosterSourceAttributes(row: Record<string, unknown>): Record<string, string | number | null> {
  const { worker_files_json: files, ...original } = row
  const attributes: Record<string, string | number | null> = {
    workerOriginalJson: JSON.stringify(original),
    workerFilesJson: typeof files === 'string' ? files : '[]',
  }
  for (const [field, column] of Object.entries(FIELDS)) {
    if (row[column] !== undefined) {
      if (row[column] !== null && typeof row[column] !== 'string')
        throw new Error(`工人原字段 ${column} 必须为文本或空值`)
      attributes[field] = row[column] as string | null
    }
  }
  if (row.safety_education !== undefined) {
    if (![0, 1, null].includes(row.safety_education as number | null))
      throw new Error('工人原安全教育状态无效')
    attributes.safetyEducation = row.safety_education as number | null
  }
  return attributes
}
