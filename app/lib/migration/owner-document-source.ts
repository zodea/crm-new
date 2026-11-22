/** Shared read-only presentation SQL. Complete production provenance is captured separately. */
export const OWNER_DOCUMENT_SOURCE_SQL = `
    SELECT * FROM (
      SELECT
        change_order.id,
        change_order.name,
        change_order.project_id,
        change_order.contract_id,
        NULL AS supplier_id,
        COALESCE(change_order.approved_tax_inclusive_amount, change_order.total_amount, 0) AS amount,
        NULL AS audited_amount,
        change_order.approved_tax_exclusive_amount AS tax_exclusive_amount,
        change_order.applied_tax_exclusive_amount AS applied_tax_exclusive_amount,
        NULL AS changed_area,
        NULL AS actual_approved_price,
        'owner_change' AS kind,
        change_order.code AS no,
        change_order.document_type,
        'boq_change_order' AS source_type,
        CASE WHEN change_order.status = 'approved' THEN 1 ELSE 0 END AS source_locked,
        '' AS period_no,
        change_order.application_date,
        change_order.approved_at AS approval_date,
        NULL AS quantity_basis,
        NULL AS quantity_source_version,
        NULL AS quantity_source_updated_at,
        '' AS operator_name,
        NULL AS submitted_at,
        change_order.status,
        change_order.status_note,
        change_order.note,
        COALESCE((
          SELECT json_group_array(json_object(
            'id', change_line.id,
            'boqLineId', COALESCE(change_line.result_boq_line_id, change_line.boq_line_id),
            'operation', change_line.operation,
            'itemName', change_line.item_name,
            'unit', change_line.unit,
            'contractQty', COALESCE(boq_line.recognized_qty, boq_line.qty),
            'contractUnitPrice', COALESCE(boq_line.recognized_unit_price, boq_line.unit_price),
            'deltaQty', change_line.delta_qty,
            'newUnitPrice', change_line.new_unit_price,
            'amount', change_line.amount,
            'note', change_line.note
          ))
          FROM boq_change_lines change_line
          LEFT JOIN boq_lines boq_line ON boq_line.id = COALESCE(change_line.result_boq_line_id, change_line.boq_line_id)
          WHERE change_line.change_order_id = change_order.id
            AND change_line.deleted_at IS NULL
          ORDER BY change_line.sort_order, change_line.id
        ), '[]') AS lines_json,
        COALESCE((
          SELECT json_group_array(json_object(
            'id', file_ref.id,
            'fileName', file_ref.file_name,
            'fileSize', file_ref.file_size,
            'mimeType', file_ref.mime_type,
            'category', file_ref.category,
            'uploader', file_ref.uploader,
            'uploadedAt', file_ref.uploaded_at,
            'deletedAt', file_ref.deleted_at
          ))
          FROM file_refs file_ref
          WHERE file_ref.owner_type = 'boq_change_order'
            AND file_ref.owner_id = change_order.id
        ), '[]') AS files_json,
        '{}' AS acceptance_lifecycle_json,
        '[]' AS lifecycle_events_json,
        change_order.created_at,
        change_order.updated_at,
        change_order.deleted_at,
        '' AS settlement_basis,
        '' AS settlement_difference_note,
        '' AS notice_no,
        '' AS penalty_reason,
        '' AS appeal_note
      FROM boq_change_orders change_order

      UNION ALL

      SELECT
        ledger.id,
        ledger.name,
        ledger.project_id,
        ledger.contract_id,
        NULL AS supplier_id,
        ledger.tax_inc_amount AS amount,
        NULL AS audited_amount,
        ledger.tax_exc_amount AS tax_exclusive_amount,
        ledger.applied_amount AS applied_tax_exclusive_amount,
        NULL AS changed_area,
        NULL AS actual_approved_price,
        'owner_change' AS kind,
        ledger.change_no AS no,
        ledger.document_type,
        'manual' AS source_type,
        ledger.source_locked,
        '' AS period_no,
        ledger.application_date,
        ledger.approval_date,
        NULL AS quantity_basis,
        NULL AS quantity_source_version,
        NULL AS quantity_source_updated_at,
        '' AS operator_name,
        NULL AS submitted_at,
        ledger.status,
        ledger.status_note,
        ledger.note,
        '[]' AS lines_json,
        COALESCE((
          SELECT json_group_array(json_object(
            'id', file_ref.id,
            'fileName', file_ref.file_name,
            'fileSize', file_ref.file_size,
            'mimeType', file_ref.mime_type,
            'category', file_ref.category,
            'uploader', file_ref.uploader,
            'uploadedAt', file_ref.uploaded_at,
            'deletedAt', file_ref.deleted_at
          ))
          FROM file_refs file_ref
          WHERE file_ref.owner_type = 'owner_change_order'
            AND file_ref.owner_id = ledger.id
        ), '[]') AS files_json,
        '{}' AS acceptance_lifecycle_json,
        '[]' AS lifecycle_events_json,
        ledger.created_at,
        ledger.updated_at,
        ledger.deleted_at,
        '' AS settlement_basis,
        '' AS settlement_difference_note,
        '' AS notice_no,
        '' AS penalty_reason,
        '' AS appeal_note
      FROM owner_change_orders ledger
      WHERE ledger.source_type = 'manual'

      UNION ALL

      SELECT
        statement.id,
        COALESCE(NULLIF(statement.period_no, ''), statement.month) || '月度报量' AS name,
        statement.project_id,
        statement.contract_id,
        NULL AS supplier_id,
        COALESCE(statement.reported_amount, statement.total_amount, 0) AS amount,
        statement.audited_amount,
        NULL AS tax_exclusive_amount,
        NULL AS applied_tax_exclusive_amount,
        NULL AS changed_area,
        NULL AS actual_approved_price,
        'owner_report' AS kind,
        statement.no,
        'monthly_statement' AS document_type,
        'monthly_statement' AS source_type,
        CASE WHEN statement.status = 'exported' THEN 1 ELSE 0 END AS source_locked,
        COALESCE(NULLIF(statement.period_no, ''), statement.month) AS period_no,
        statement.application_date,
        NULL AS approval_date,
        statement.quantity_basis,
        statement.source_version AS quantity_source_version,
        statement.source_updated_at AS quantity_source_updated_at,
        statement.operator_name,
        statement.submitted_at,
        statement.status,
        CASE WHEN statement.status = 'exported' THEN '甲方已审定'
             WHEN statement.status = 'adjusted' THEN '已申报甲方'
             ELSE '' END AS status_note,
        statement.note,
        COALESCE((
          SELECT json_group_array(json_object(
            'id', report_line.id,
            'boqLineId', report_line.boq_line_id,
            'operation', NULL,
            'itemName', report_line.item_name,
            'unit', report_line.unit,
            'contractQty', COALESCE(boq_line.recognized_qty, boq_line.qty),
            'contractUnitPrice', report_line.unit_price,
            'autoQty', report_line.auto_qty,
            'reportedQty', COALESCE(report_line.reported_qty, report_line.adjusted_qty),
            'auditedQty', report_line.audited_qty,
            'amount', report_line.amount,
            'auditedAmount', report_line.audited_amount,
            'note', report_line.note
          ))
          FROM monthly_statement_lines report_line
          LEFT JOIN boq_lines boq_line ON boq_line.id = report_line.boq_line_id
          WHERE report_line.statement_id = statement.id
            AND report_line.deleted_at IS NULL
          ORDER BY report_line.sort_order, report_line.id
        ), '[]') AS lines_json,
        COALESCE((
          SELECT json_group_array(json_object(
            'id', file_ref.id,
            'fileName', file_ref.file_name,
            'fileSize', file_ref.file_size,
            'mimeType', file_ref.mime_type,
            'category', file_ref.category,
            'uploader', file_ref.uploader,
            'uploadedAt', file_ref.uploaded_at,
            'deletedAt', file_ref.deleted_at
          ))
          FROM file_refs file_ref
          WHERE file_ref.owner_type = 'monthly_statement'
            AND file_ref.owner_id = statement.id
        ), '[]') AS files_json,
        '{}' AS acceptance_lifecycle_json,
        '[]' AS lifecycle_events_json,
        statement.created_at,
        statement.updated_at,
        statement.deleted_at,
        '' AS settlement_basis,
        '' AS settlement_difference_note,
        '' AS notice_no,
        '' AS penalty_reason,
        '' AS appeal_note
      FROM monthly_statements statement

      UNION ALL

      SELECT
        acceptance.id,
        acceptance.name,
        acceptance.project_id,
        acceptance.contract_id,
        NULL AS supplier_id,
        acceptance.contract_estimate AS amount,
        NULL AS audited_amount,
        NULL AS tax_exclusive_amount,
        NULL AS applied_tax_exclusive_amount,
        NULL AS changed_area,
        NULL AS actual_approved_price,
        'acceptance' AS kind,
        acceptance.no,
        'acceptance_lifecycle' AS document_type,
        'manual' AS source_type,
        CASE WHEN acceptance.status IN ('accepted', 'warranty', 'expired') THEN 1 ELSE 0 END AS source_locked,
        '' AS period_no,
        acceptance.document_date AS application_date,
        NULL AS approval_date,
        NULL AS quantity_basis,
        NULL AS quantity_source_version,
        NULL AS quantity_source_updated_at,
        acceptance.acceptor AS operator_name,
        NULL AS submitted_at,
        acceptance.status,
        CASE acceptance.status
          WHEN 'submitted' THEN '验收中'
          WHEN 'accepted' THEN '验收合格'
          WHEN 'warranty' THEN '保修中'
          WHEN 'expired' THEN '保修到期已确认'
          ELSE ''
        END AS status_note,
        acceptance.note,
        '[]' AS lines_json,
        COALESCE((
          SELECT json_group_array(json_object(
            'id', file_ref.id,
            'fileName', file_ref.file_name,
            'fileSize', file_ref.file_size,
            'mimeType', file_ref.mime_type,
            'category', CASE
              WHEN file_ref.category IN ('acceptance-report', 'warranty-confirmation') THEN file_ref.category
              WHEN acceptance.type = 'warranty' THEN 'warranty-confirmation'
              ELSE 'acceptance-report'
            END,
            'uploader', file_ref.uploader,
            'uploadedAt', file_ref.uploaded_at,
            'deletedAt', file_ref.deleted_at
          ))
          FROM file_refs file_ref
          WHERE file_ref.owner_type = 'project_acceptance'
            AND file_ref.owner_id = acceptance.id
        ), '[]') AS files_json,
        json_object(
          'acceptanceOrganization', acceptance.acceptance_organization,
          'acceptancePerson', acceptance.acceptor,
          'acceptanceDate', acceptance.acceptance_date,
          'acceptanceConclusion', acceptance.acceptance_conclusion,
          'warrantyOwner', acceptance.warranty_owner,
          'warrantyStartDate', acceptance.warranty_start_date,
          'warrantyEndDate', acceptance.warranty_end_date,
          'warrantyConfirmationOrganization', acceptance.warranty_confirmation_organization,
          'warrantyConfirmationDate', acceptance.warranty_confirmation_date,
          'warrantyConfirmationNote', acceptance.warranty_confirmation_note
        ) AS acceptance_lifecycle_json,
        COALESCE((
          SELECT json_group_array(json_object(
            'id', lifecycle_event.id,
            'action', lifecycle_event.action,
            'fromStatus', lifecycle_event.from_status,
            'toStatus', lifecycle_event.to_status,
            'actorId', lifecycle_event.actor_id,
            'actorName', lifecycle_event.actor_name,
            'occurredAt', lifecycle_event.occurred_at,
            'note', lifecycle_event.note
          ))
          FROM project_acceptance_lifecycle_events lifecycle_event
          WHERE lifecycle_event.acceptance_id = acceptance.id
          ORDER BY lifecycle_event.occurred_at, lifecycle_event.id
        ), '[]') AS lifecycle_events_json,
        acceptance.created_at,
        acceptance.updated_at,
        acceptance.deleted_at,
        '' AS settlement_basis,
        '' AS settlement_difference_note,
        '' AS notice_no,
        '' AS penalty_reason,
        '' AS appeal_note
      FROM project_acceptances acceptance

      UNION ALL

      SELECT
        settlement.id,
        settlement.name,
        settlement.project_id,
        settlement.contract_id,
        NULL AS supplier_id,
        settlement.settlement_amount AS amount,
        settlement.audited_amount,
        NULL AS tax_exclusive_amount,
        NULL AS applied_tax_exclusive_amount,
        NULL AS changed_area,
        NULL AS actual_approved_price,
        'final_settlement' AS kind,
        settlement.no,
        'final_settlement' AS document_type,
        'owner_final_settlement' AS source_type,
        CASE WHEN settlement.status <> 'draft' THEN 1 ELSE 0 END AS source_locked,
        '' AS period_no,
        settlement.submission_date AS application_date,
        settlement.audited_date AS approval_date,
        NULL AS quantity_basis,
        NULL AS quantity_source_version,
        NULL AS quantity_source_updated_at,
        '' AS operator_name,
        NULL AS submitted_at,
        settlement.status,
        CASE settlement.status
          WHEN 'submitted' THEN '已提交甲方结算资料'
          WHEN 'audited' THEN '甲方已审定'
          ELSE ''
        END AS status_note,
        settlement.note,
        '[]' AS lines_json,
        COALESCE((
          SELECT json_group_array(json_object(
            'id', file_ref.id,
            'fileName', file_ref.file_name,
            'fileSize', file_ref.file_size,
            'mimeType', file_ref.mime_type,
            'category', file_ref.category,
            'uploader', file_ref.uploader,
            'uploadedAt', file_ref.uploaded_at,
            'deletedAt', file_ref.deleted_at
          ))
          FROM file_refs file_ref
          WHERE file_ref.owner_type = 'owner_final_settlement'
            AND file_ref.owner_id = settlement.id
        ), '[]') AS files_json,
        '{}' AS acceptance_lifecycle_json,
        '[]' AS lifecycle_events_json,
        settlement.created_at,
        settlement.updated_at,
        settlement.deleted_at,
        settlement.basis AS settlement_basis,
        settlement.difference_note AS settlement_difference_note,
        '' AS notice_no,
        '' AS penalty_reason,
        '' AS appeal_note
      FROM owner_final_settlements settlement

      UNION ALL

      SELECT
        penalty.id,
        penalty.reason AS name,
        penalty.project_id,
        penalty.contract_id,
        NULL AS supplier_id,
        penalty.amount,
        NULL AS audited_amount,
        NULL AS tax_exclusive_amount,
        NULL AS applied_tax_exclusive_amount,
        NULL AS changed_area,
        NULL AS actual_approved_price,
        'owner_penalty' AS kind,
        penalty.no,
        'owner_penalty' AS document_type,
        'owner_penalty' AS source_type,
        CASE WHEN penalty.status <> 'draft' THEN 1 ELSE 0 END AS source_locked,
        '' AS period_no,
        penalty.penalty_date AS application_date,
        NULL AS approval_date,
        NULL AS quantity_basis,
        NULL AS quantity_source_version,
        NULL AS quantity_source_updated_at,
        '' AS operator_name,
        NULL AS submitted_at,
        penalty.status,
        CASE WHEN penalty.status = 'submitted' THEN '已提交甲方罚扣事实' ELSE '' END AS status_note,
        penalty.note,
        '[]' AS lines_json,
        COALESCE((
          SELECT json_group_array(json_object(
            'id', file_ref.id,
            'fileName', file_ref.file_name,
            'fileSize', file_ref.file_size,
            'mimeType', file_ref.mime_type,
            'category', file_ref.category,
            'uploader', file_ref.uploader,
            'uploadedAt', file_ref.uploaded_at,
            'deletedAt', file_ref.deleted_at
          ))
          FROM file_refs file_ref
          WHERE file_ref.owner_type = 'owner_penalty'
            AND file_ref.owner_id = penalty.id
        ), '[]') AS files_json,
        '{}' AS acceptance_lifecycle_json,
        '[]' AS lifecycle_events_json,
        penalty.created_at,
        penalty.updated_at,
        penalty.deleted_at,
        '' AS settlement_basis,
        '' AS settlement_difference_note,
        penalty.notice_no,
        penalty.reason AS penalty_reason,
        penalty.appeal_note
      FROM owner_penalties penalty

      UNION ALL

      SELECT
        subcontract_change.id,
        subcontract_change.reason AS name,
        subcontract_change.project_id,
        subcontract_change.contract_id,
        subcontract_change.supplier_id,
        subcontract_change.approved_amount AS amount,
        NULL AS audited_amount,
        NULL AS tax_exclusive_amount,
        NULL AS applied_tax_exclusive_amount,
        subcontract_change.changed_area,
        subcontract_change.actual_approved_price,
        'sub_change' AS kind,
        subcontract_change.no,
        subcontract_change.change_type AS document_type,
        'subcontract_change_order' AS source_type,
        CASE WHEN subcontract_change.status NOT IN ('draft', 'rejected') THEN 1 ELSE 0 END AS source_locked,
        '' AS period_no,
        subcontract_change.change_date AS application_date,
        NULL AS approval_date,
        NULL AS quantity_basis,
        NULL AS quantity_source_version,
        NULL AS quantity_source_updated_at,
        '' AS operator_name,
        NULL AS submitted_at,
        subcontract_change.status,
        CASE WHEN subcontract_change.status = 'submitted' THEN '已提交分包变洽签'
             WHEN subcontract_change.status = 'approved' THEN '分包变洽签已审批'
             ELSE '' END AS status_note,
        subcontract_change.note,
        '[]' AS lines_json,
        COALESCE((
          SELECT json_group_array(json_object(
            'id', file_ref.id,
            'fileName', file_ref.file_name,
            'fileSize', file_ref.file_size,
            'mimeType', file_ref.mime_type,
            'category', file_ref.category,
            'uploader', file_ref.uploader,
            'uploadedAt', file_ref.uploaded_at,
            'deletedAt', file_ref.deleted_at
          ))
          FROM file_refs file_ref
          WHERE file_ref.owner_type = 'subcontract_change_order'
            AND file_ref.owner_id = subcontract_change.id
        ), '[]') AS files_json,
        '{}' AS acceptance_lifecycle_json,
        '[]' AS lifecycle_events_json,
        subcontract_change.created_at,
        subcontract_change.updated_at,
        subcontract_change.deleted_at,
        '' AS settlement_basis,
        '' AS settlement_difference_note,
        '' AS notice_no,
        '' AS penalty_reason,
        '' AS appeal_note
      FROM subcontract_change_orders subcontract_change

      UNION ALL

      SELECT
        settlement.id,
        settlement.name,
        settlement.project_id,
        settlement.contract_id,
        settlement.supplier_id,
        settlement.total_amount AS amount,
        NULL AS audited_amount,
        NULL AS tax_exclusive_amount,
        NULL AS applied_tax_exclusive_amount,
        NULL AS changed_area,
        NULL AS actual_approved_price,
        'sub_settlement' AS kind,
        settlement.no,
        settlement.settlement_type AS document_type,
        'expenditure_settlement' AS source_type,
        CASE WHEN settlement.status NOT IN ('draft') THEN 1 ELSE 0 END AS source_locked,
        '' AS period_no,
        settlement.settlement_date AS application_date,
        NULL AS approval_date,
        NULL AS quantity_basis,
        NULL AS quantity_source_version,
        NULL AS quantity_source_updated_at,
        '' AS operator_name,
        NULL AS submitted_at,
        settlement.status,
        CASE WHEN settlement.status = 'confirmed' THEN '已确认分包结算'
             ELSE '' END AS status_note,
        settlement.note,
        '[]' AS lines_json,
        COALESCE((
          SELECT json_group_array(json_object(
            'id', file_ref.id,
            'fileName', file_ref.file_name,
            'fileSize', file_ref.file_size,
            'mimeType', file_ref.mime_type,
            'category', file_ref.category,
            'uploader', file_ref.uploader,
            'uploadedAt', file_ref.uploaded_at,
            'deletedAt', file_ref.deleted_at
          ))
          FROM file_refs file_ref
          WHERE file_ref.owner_type = 'expenditure_settlement'
            AND file_ref.owner_id = settlement.id
        ), '[]') AS files_json,
        '{}' AS acceptance_lifecycle_json,
        '[]' AS lifecycle_events_json,
        settlement.created_at,
        settlement.updated_at,
        settlement.deleted_at,
        '' AS settlement_basis,
        settlement.deduction_note AS settlement_difference_note,
        '' AS notice_no,
        '' AS penalty_reason,
        '' AS appeal_note
      FROM expenditure_settlements settlement
      WHERE settlement.biz_type IN ('分包', '专业分包', '合同劳务')
    ) owner_document
    ORDER BY kind, id
  `

export const PROJECT_PENALTY_SOURCE_SQL = `
  SELECT penalty.id, penalty.reason AS name, penalty.no,
    penalty.source AS penalty_origin,
    penalty.projectId AS project_id, penalty.crewId AS crew_id,
    penalty.supplier_id,
    CASE WHEN EXISTS (SELECT 1 FROM contracts c WHERE c.id = penalty.contract_id AND c.kind = '其他支出') THEN 'other_expense:' || penalty.contract_id ELSE penalty.contract_id END AS contract_id,
    CASE WHEN EXISTS (SELECT 1 FROM contracts c WHERE c.id = penalty.contract_id AND c.kind = '其他支出') THEN 'other_expense' ELSE 'subcontract' END AS contract_kind,
    penalty.amount,
    'project_penalty' AS kind, 'penalty_record' AS source_type,
    CASE WHEN penalty.status <> 'draft' THEN 1 ELSE 0 END AS source_locked,
    penalty.penaltyDate AS application_date, penalty.status,
    penalty.deduction_method AS document_type, penalty.deduction_method,
    penalty.deadline, penalty.rectification_note, penalty.note,
    penalty.createdAt AS created_at, penalty.updated_at, penalty.deleted_at,
    (SELECT json_group_array(json_object(
      'id', d.id, 'settlementId', d.settlement_id, 'amount', d.amount,
      'occurredAt', strftime('%Y-%m-%dT%H:%M:%fZ', d.created_at),
      'actorId', '', 'commandId', '', 'note', d.note))
      FROM penalty_settlement_deductions d WHERE d.penalty_id = penalty.id AND d.deleted_at IS NULL) AS penalty_deductions_json,
    (SELECT json_group_array(json_object(
      'id', f.id, 'fileName', f.file_name, 'fileSize', f.file_size, 'mimeType', f.mime_type,
      'category', f.category, 'uploader', f.uploader, 'uploadedAt', f.uploaded_at, 'deletedAt', f.deleted_at))
      FROM file_refs f WHERE f.owner_type = 'penalty_record' AND f.owner_id = penalty.id) AS files_json
  FROM penalty_records penalty WHERE penalty.source = 'project'
    OR EXISTS (SELECT 1 FROM penalty_settlement_deductions d JOIN expenditure_settlements s ON s.id = d.settlement_id WHERE d.penalty_id = penalty.id AND s.biz_type IN ('机械', '其他', '其他支出'))
`
