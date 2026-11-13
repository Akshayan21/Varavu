// Typed mappings introspected from the production public schema.
// Supabase SQL migrations own constraints, indexes, RLS, triggers, grants and functions.
import { sql } from 'drizzle-orm';
import { pgTable, uuid, text, boolean, integer, bigint, numeric, date, timestamp, jsonb, primaryKey, unique } from 'drizzle-orm/pg-core';

export const audit_logs = pgTable('audit_logs', {
  id: uuid('id').notNull().default(sql`gen_random_uuid()`),
  workspace_id: uuid('workspace_id').notNull(),
  entity_id: uuid('entity_id'),
  actor_user_id: uuid('actor_user_id'),
  actor_type: text('actor_type').notNull().default(sql`'user'::text`),
  action: text('action').notNull(),
  resource_type: text('resource_type').notNull(),
  resource_id: uuid('resource_id').notNull(),
  request_id: text('request_id'),
  before_json: jsonb('before_json'),
  after_json: jsonb('after_json'),
  metadata_json: jsonb('metadata_json').notNull().default(sql`'{}'::jsonb`),
  occurred_at: timestamp('occurred_at', { withTimezone: true, mode: 'string' }).notNull().default(sql`now()`),
}, table => [
  primaryKey({ name: 'audit_logs_pkey', columns: [table.id] }),
]);
export type AuditLogsRow = typeof audit_logs.$inferSelect;
export type NewAuditLogs = typeof audit_logs.$inferInsert;

export const billing_entities = pgTable('billing_entities', {
  id: uuid('id').notNull().default(sql`gen_random_uuid()`),
  workspace_id: uuid('workspace_id').notNull(),
  entity_code: text('entity_code').notNull(),
  legal_name: text('legal_name').notNull(),
  display_name: text('display_name'),
  billing_address: jsonb('billing_address').notNull().default(sql`'{}'::jsonb`),
  email: text('email'),
  phone: text('phone'),
  gst_registered: boolean('gst_registered').notNull().default(sql`false`),
  gstin: text('gstin'),
  pan: text('pan'),
  state_code: text('state_code'),
  bank_details: jsonb('bank_details').notNull().default(sql`'{}'::jsonb`),
  upi_id: text('upi_id'),
  payment_instructions: text('payment_instructions'),
  invoice_prefix: text('invoice_prefix'),
  default_due_days: integer('default_due_days').notNull().default(sql`30`),
  financial_year_start_month: integer('financial_year_start_month').notNull().default(sql`4`),
  is_active: boolean('is_active').notNull().default(sql`true`),
  created_at: timestamp('created_at', { withTimezone: true, mode: 'string' }).notNull().default(sql`now()`),
  updated_at: timestamp('updated_at', { withTimezone: true, mode: 'string' }).notNull().default(sql`now()`),
  dc_prefix: text('dc_prefix'),
  numbering_mode: text('numbering_mode').notNull().default(sql`'financial_year'::text`),
  currency: text('currency').notNull().default(sql`'INR'::text`),
  default_tax_profile_id: uuid('default_tax_profile_id'),
  default_invoice_template_id: uuid('default_invoice_template_id'),
  default_dc_template_id: uuid('default_dc_template_id'),
  logo_path: text('logo_path'),
  signature_path: text('signature_path'),
  default_terms: text('default_terms'),
  rounding_increment: numeric('rounding_increment').notNull().default(sql`0`),
  archived_at: timestamp('archived_at', { withTimezone: true, mode: 'string' }),
  version: bigint('version', { mode: 'bigint' }).notNull().default(sql`1`),
  created_by: uuid('created_by'),
  updated_by: uuid('updated_by'),
  import_source: text('import_source'),
  import_external_id: text('import_external_id'),
}, table => [
  primaryKey({ name: 'billing_entities_pkey', columns: [table.id] }),
  unique('billing_entities_workspace_id_entity_code_key').on(table.workspace_id, table.entity_code),
  unique('billing_entities_workspace_id_id_key').on(table.workspace_id, table.id),
]);
export type BillingEntitiesRow = typeof billing_entities.$inferSelect;
export type NewBillingEntities = typeof billing_entities.$inferInsert;

export const customers = pgTable('customers', {
  id: uuid('id').notNull().default(sql`gen_random_uuid()`),
  workspace_id: uuid('workspace_id').notNull(),
  legal_name: text('legal_name').notNull(),
  display_name: text('display_name'),
  billing_address: jsonb('billing_address').notNull().default(sql`'{}'::jsonb`),
  shipping_address: jsonb('shipping_address'),
  contact_name: text('contact_name'),
  email: text('email'),
  phone: text('phone'),
  gstin: text('gstin'),
  state_code: text('state_code'),
  country: text('country'),
  payment_terms_days: integer('payment_terms_days'),
  notes: text('notes'),
  is_active: boolean('is_active').notNull().default(sql`true`),
  created_at: timestamp('created_at', { withTimezone: true, mode: 'string' }).notNull().default(sql`now()`),
  updated_at: timestamp('updated_at', { withTimezone: true, mode: 'string' }).notNull().default(sql`now()`),
  entity_id: uuid('entity_id').notNull(),
  contact_phone: text('contact_phone'),
  archived_at: timestamp('archived_at', { withTimezone: true, mode: 'string' }),
  version: bigint('version', { mode: 'bigint' }).notNull().default(sql`1`),
  created_by: uuid('created_by'),
  updated_by: uuid('updated_by'),
  import_source: text('import_source'),
  import_external_id: text('import_external_id'),
}, table => [
  primaryKey({ name: 'customers_pkey', columns: [table.id] }),
  unique('customers_workspace_id_entity_id_id_key').on(table.workspace_id, table.entity_id, table.id),
]);
export type CustomersRow = typeof customers.$inferSelect;
export type NewCustomers = typeof customers.$inferInsert;

export const dc_items = pgTable('dc_items', {
  id: uuid('id').notNull().default(sql`gen_random_uuid()`),
  workspace_id: uuid('workspace_id').notNull(),
  entity_id: uuid('entity_id').notNull(),
  dc_id: uuid('dc_id').notNull(),
  sort_order: integer('sort_order').notNull(),
  particulars: text('particulars').notNull(),
  quantity: numeric('quantity').notNull(),
  unit_id: uuid('unit_id').notNull(),
  unit_snapshot: text('unit_snapshot').notNull(),
  remarks: text('remarks'),
  created_at: timestamp('created_at', { withTimezone: true, mode: 'string' }).notNull().default(sql`now()`),
  updated_at: timestamp('updated_at', { withTimezone: true, mode: 'string' }).notNull().default(sql`now()`),
}, table => [
  unique('dc_items_dc_id_sort_order_key').on(table.dc_id, table.sort_order),
  primaryKey({ name: 'dc_items_pkey', columns: [table.id] }),
]);
export type DcItemsRow = typeof dc_items.$inferSelect;
export type NewDcItems = typeof dc_items.$inferInsert;

export const delivery_acknowledgements = pgTable('delivery_acknowledgements', {
  id: uuid('id').notNull().default(sql`gen_random_uuid()`),
  workspace_id: uuid('workspace_id').notNull(),
  entity_id: uuid('entity_id').notNull(),
  dc_id: uuid('dc_id').notNull(),
  received_by: text('received_by'),
  received_at: timestamp('received_at', { withTimezone: true, mode: 'string' }).notNull(),
  signature_path: text('signature_path'),
  notes: text('notes'),
  recorded_at: timestamp('recorded_at', { withTimezone: true, mode: 'string' }).notNull().default(sql`now()`),
  recorded_by: uuid('recorded_by').notNull(),
}, table => [
  unique('delivery_acknowledgements_dc_id_key').on(table.dc_id),
  primaryKey({ name: 'delivery_acknowledgements_pkey', columns: [table.id] }),
]);
export type DeliveryAcknowledgementsRow = typeof delivery_acknowledgements.$inferSelect;
export type NewDeliveryAcknowledgements = typeof delivery_acknowledgements.$inferInsert;

export const delivery_challans = pgTable('delivery_challans', {
  id: uuid('id').notNull().default(sql`gen_random_uuid()`),
  workspace_id: uuid('workspace_id').notNull(),
  entity_id: uuid('entity_id').notNull(),
  customer_id: uuid('customer_id'),
  recipient_name: text('recipient_name').notNull(),
  status: text('status').notNull().default(sql`'draft'::text`),
  document_number: text('document_number'),
  period_key: text('period_key'),
  sequence_number: bigint('sequence_number', { mode: 'bigint' }),
  number_prefix_snapshot: text('number_prefix_snapshot'),
  numbering_mode_snapshot: text('numbering_mode_snapshot'),
  period_start_snapshot: date('period_start_snapshot'),
  period_end_snapshot: date('period_end_snapshot'),
  dc_date: date('dc_date').notNull(),
  related_invoice_id: uuid('related_invoice_id'),
  from_address: jsonb('from_address').notNull(),
  to_address: jsonb('to_address').notNull(),
  sender_snapshot: jsonb('sender_snapshot'),
  recipient_snapshot: jsonb('recipient_snapshot'),
  template_id: uuid('template_id'),
  template_snapshot: jsonb('template_snapshot'),
  snapshot_schema_version: integer('snapshot_schema_version').notNull().default(sql`1`),
  renderer_version: text('renderer_version'),
  notes: text('notes'),
  issued_at: timestamp('issued_at', { withTimezone: true, mode: 'string' }),
  issued_by: uuid('issued_by'),
  cancelled_at: timestamp('cancelled_at', { withTimezone: true, mode: 'string' }),
  cancelled_by: uuid('cancelled_by'),
  cancel_reason: text('cancel_reason'),
  created_at: timestamp('created_at', { withTimezone: true, mode: 'string' }).notNull().default(sql`now()`),
  updated_at: timestamp('updated_at', { withTimezone: true, mode: 'string' }).notNull().default(sql`now()`),
  version: bigint('version', { mode: 'bigint' }).notNull().default(sql`1`),
  created_by: uuid('created_by'),
  updated_by: uuid('updated_by'),
  import_source: text('import_source'),
  import_external_id: text('import_external_id'),
}, table => [
  primaryKey({ name: 'delivery_challans_pkey', columns: [table.id] }),
  unique('delivery_challans_workspace_id_entity_id_document_number_key').on(table.workspace_id, table.entity_id, table.document_number),
  unique('delivery_challans_workspace_id_entity_id_id_key').on(table.workspace_id, table.entity_id, table.id),
  unique('delivery_challans_workspace_id_entity_id_period_key_sequenc_key').on(table.workspace_id, table.entity_id, table.period_key, table.sequence_number),
]);
export type DeliveryChallansRow = typeof delivery_challans.$inferSelect;
export type NewDeliveryChallans = typeof delivery_challans.$inferInsert;

export const document_files = pgTable('document_files', {
  id: uuid('id').notNull().default(sql`gen_random_uuid()`),
  workspace_id: uuid('workspace_id').notNull(),
  entity_id: uuid('entity_id').notNull(),
  invoice_id: uuid('invoice_id'),
  dc_id: uuid('dc_id'),
  template_id: uuid('template_id').notNull(),
  document_revision: integer('document_revision').notNull().default(sql`1`),
  variant: text('variant').notNull(),
  status: text('status').notNull().default(sql`'pending'::text`),
  bucket_id: text('bucket_id').notNull().default(sql`'invoice-pdfs'::text`),
  object_path: text('object_path'),
  sha256: text('sha256'),
  mime_type: text('mime_type').notNull().default(sql`'application/pdf'::text`),
  byte_size: bigint('byte_size', { mode: 'bigint' }),
  attempt_count: integer('attempt_count').notNull().default(sql`0`),
  last_error: text('last_error'),
  lease_expires_at: timestamp('lease_expires_at', { withTimezone: true, mode: 'string' }),
  claim_token: uuid('claim_token'),
  next_attempt_at: timestamp('next_attempt_at', { withTimezone: true, mode: 'string' }).notNull().default(sql`now()`),
  generated_at: timestamp('generated_at', { withTimezone: true, mode: 'string' }),
  created_at: timestamp('created_at', { withTimezone: true, mode: 'string' }).notNull().default(sql`now()`),
  updated_at: timestamp('updated_at', { withTimezone: true, mode: 'string' }).notNull().default(sql`now()`),
}, table => [
  primaryKey({ name: 'document_files_pkey', columns: [table.id] }),
]);
export type DocumentFilesRow = typeof document_files.$inferSelect;
export type NewDocumentFiles = typeof document_files.$inferInsert;

export const document_sequences = pgTable('document_sequences', {
  workspace_id: uuid('workspace_id').notNull(),
  entity_id: uuid('entity_id').notNull(),
  document_type: text('document_type').notNull(),
  period_key: text('period_key').notNull(),
  period_start: date('period_start'),
  period_end: date('period_end'),
  next_number: bigint('next_number', { mode: 'bigint' }).notNull().default(sql`1`),
  updated_at: timestamp('updated_at', { withTimezone: true, mode: 'string' }).notNull().default(sql`now()`),
}, table => [
  primaryKey({ name: 'document_sequences_pkey', columns: [table.workspace_id, table.entity_id, table.document_type, table.period_key] }),
]);
export type DocumentSequencesRow = typeof document_sequences.$inferSelect;
export type NewDocumentSequences = typeof document_sequences.$inferInsert;

export const document_templates = pgTable('document_templates', {
  id: uuid('id').notNull().default(sql`gen_random_uuid()`),
  workspace_id: uuid('workspace_id').notNull(),
  entity_id: uuid('entity_id').notNull(),
  document_type: text('document_type').notNull(),
  name: text('name').notNull(),
  version_number: integer('version_number').notNull(),
  status: text('status').notNull().default(sql`'draft'::text`),
  settings_schema_version: integer('settings_schema_version').notNull().default(sql`1`),
  settings_json: jsonb('settings_json').notNull().default(sql`'{}'::jsonb`),
  renderer_version: text('renderer_version').notNull().default(sql`'thogai-v1'::text`),
  published_at: timestamp('published_at', { withTimezone: true, mode: 'string' }),
  created_at: timestamp('created_at', { withTimezone: true, mode: 'string' }).notNull().default(sql`now()`),
  updated_at: timestamp('updated_at', { withTimezone: true, mode: 'string' }).notNull().default(sql`now()`),
  created_by: uuid('created_by'),
  updated_by: uuid('updated_by'),
  version: bigint('version', { mode: 'bigint' }).notNull().default(sql`1`),
}, table => [
  primaryKey({ name: 'document_templates_pkey', columns: [table.id] }),
  unique('document_templates_workspace_id_entity_id_document_type_nam_key').on(table.workspace_id, table.entity_id, table.document_type, table.name, table.version_number),
  unique('document_templates_workspace_id_entity_id_id_key').on(table.workspace_id, table.entity_id, table.id),
]);
export type DocumentTemplatesRow = typeof document_templates.$inferSelect;
export type NewDocumentTemplates = typeof document_templates.$inferInsert;

export const idempotency_keys = pgTable('idempotency_keys', {
  workspace_id: uuid('workspace_id').notNull(),
  actor_user_id: uuid('actor_user_id').notNull(),
  operation: text('operation').notNull(),
  key: text('key').notNull(),
  request_hash: text('request_hash').notNull(),
  resource_id: uuid('resource_id'),
  response_json: jsonb('response_json'),
  created_at: timestamp('created_at', { withTimezone: true, mode: 'string' }).notNull().default(sql`now()`),
  expires_at: timestamp('expires_at', { withTimezone: true, mode: 'string' }),
}, table => [
  primaryKey({ name: 'idempotency_keys_pkey', columns: [table.workspace_id, table.actor_user_id, table.operation, table.key] }),
]);
export type IdempotencyKeysRow = typeof idempotency_keys.$inferSelect;
export type NewIdempotencyKeys = typeof idempotency_keys.$inferInsert;

export const invoice_items = pgTable('invoice_items', {
  id: uuid('id').notNull().default(sql`gen_random_uuid()`),
  workspace_id: uuid('workspace_id').notNull(),
  entity_id: uuid('entity_id').notNull(),
  invoice_id: uuid('invoice_id').notNull(),
  sort_order: integer('sort_order').notNull(),
  style_id: uuid('style_id'),
  style_number_snapshot: text('style_number_snapshot'),
  print_type_id: uuid('print_type_id'),
  placement_id: uuid('placement_id'),
  unit_id: uuid('unit_id'),
  print_type_snapshot: text('print_type_snapshot'),
  placement_snapshot: text('placement_snapshot'),
  unit_snapshot: text('unit_snapshot'),
  placement_detail: text('placement_detail'),
  particulars: text('particulars').notNull(),
  hsn_sac_code: text('hsn_sac_code'),
  quantity: numeric('quantity').notNull(),
  unit_rate: numeric('unit_rate').notNull(),
  gross_amount: numeric('gross_amount').notNull(),
  line_adjustment_amount: numeric('line_adjustment_amount').notNull().default(sql`0`),
  line_adjustment_reason: text('line_adjustment_reason'),
  line_discount_amount: numeric('line_discount_amount').notNull().default(sql`0`),
  invoice_discount_share: numeric('invoice_discount_share').notNull().default(sql`0`),
  taxable_amount: numeric('taxable_amount').notNull(),
  tax_profile_id: uuid('tax_profile_id'),
  tax_mode_snapshot: text('tax_mode_snapshot').notNull().default(sql`'none'::text`),
  cgst_rate: numeric('cgst_rate').notNull().default(sql`0`),
  sgst_rate: numeric('sgst_rate').notNull().default(sql`0`),
  igst_rate: numeric('igst_rate').notNull().default(sql`0`),
  other_tax_rate: numeric('other_tax_rate').notNull().default(sql`0`),
  cgst_amount: numeric('cgst_amount').notNull().default(sql`0`),
  sgst_amount: numeric('sgst_amount').notNull().default(sql`0`),
  igst_amount: numeric('igst_amount').notNull().default(sql`0`),
  other_tax_amount: numeric('other_tax_amount').notNull().default(sql`0`),
  tax_amount: numeric('tax_amount').notNull().default(sql`0`),
  line_total: numeric('line_total').notNull(),
  created_at: timestamp('created_at', { withTimezone: true, mode: 'string' }).notNull().default(sql`now()`),
  updated_at: timestamp('updated_at', { withTimezone: true, mode: 'string' }).notNull().default(sql`now()`),
}, table => [
  unique('invoice_items_invoice_id_sort_order_key').on(table.invoice_id, table.sort_order),
  primaryKey({ name: 'invoice_items_pkey', columns: [table.id] }),
]);
export type InvoiceItemsRow = typeof invoice_items.$inferSelect;
export type NewInvoiceItems = typeof invoice_items.$inferInsert;

export const invoices = pgTable('invoices', {
  id: uuid('id').notNull().default(sql`gen_random_uuid()`),
  workspace_id: uuid('workspace_id').notNull(),
  entity_id: uuid('entity_id').notNull(),
  customer_id: uuid('customer_id').notNull(),
  status: text('status').notNull().default(sql`'draft'::text`),
  document_number: text('document_number'),
  period_key: text('period_key'),
  sequence_number: bigint('sequence_number', { mode: 'bigint' }),
  number_prefix_snapshot: text('number_prefix_snapshot'),
  numbering_mode_snapshot: text('numbering_mode_snapshot'),
  period_start_snapshot: date('period_start_snapshot'),
  period_end_snapshot: date('period_end_snapshot'),
  invoice_date: date('invoice_date').notNull(),
  due_date: date('due_date').notNull(),
  issued_at: timestamp('issued_at', { withTimezone: true, mode: 'string' }),
  issued_by: uuid('issued_by'),
  reference_number: text('reference_number'),
  replacement_for_invoice_id: uuid('replacement_for_invoice_id'),
  currency: text('currency').notNull().default(sql`'INR'::text`),
  subtotal: numeric('subtotal').notNull().default(sql`0`),
  line_adjustment_total: numeric('line_adjustment_total').notNull().default(sql`0`),
  line_discount_total: numeric('line_discount_total').notNull().default(sql`0`),
  invoice_discount_total: numeric('invoice_discount_total').notNull().default(sql`0`),
  taxable_total: numeric('taxable_total').notNull().default(sql`0`),
  cgst_total: numeric('cgst_total').notNull().default(sql`0`),
  sgst_total: numeric('sgst_total').notNull().default(sql`0`),
  igst_total: numeric('igst_total').notNull().default(sql`0`),
  other_tax_total: numeric('other_tax_total').notNull().default(sql`0`),
  tax_total: numeric('tax_total').notNull().default(sql`0`),
  round_off: numeric('round_off').notNull().default(sql`0`),
  grand_total: numeric('grand_total').notNull().default(sql`0`),
  calculation_version: text('calculation_version').notNull().default(sql`'line-v1'::text`),
  rounding_increment_snapshot: numeric('rounding_increment_snapshot').notNull().default(sql`0`),
  place_of_supply_state_code: text('place_of_supply_state_code'),
  tax_treatment: text('tax_treatment'),
  notes: text('notes'),
  terms: text('terms'),
  internal_memo: text('internal_memo'),
  shipping_details: jsonb('shipping_details'),
  seller_snapshot: jsonb('seller_snapshot'),
  customer_snapshot: jsonb('customer_snapshot'),
  payment_details_snapshot: jsonb('payment_details_snapshot'),
  template_id: uuid('template_id'),
  template_snapshot: jsonb('template_snapshot'),
  snapshot_schema_version: integer('snapshot_schema_version').notNull().default(sql`1`),
  renderer_version: text('renderer_version'),
  cancelled_at: timestamp('cancelled_at', { withTimezone: true, mode: 'string' }),
  cancelled_by: uuid('cancelled_by'),
  cancel_reason: text('cancel_reason'),
  created_at: timestamp('created_at', { withTimezone: true, mode: 'string' }).notNull().default(sql`now()`),
  updated_at: timestamp('updated_at', { withTimezone: true, mode: 'string' }).notNull().default(sql`now()`),
  version: bigint('version', { mode: 'bigint' }).notNull().default(sql`1`),
  created_by: uuid('created_by'),
  updated_by: uuid('updated_by'),
  import_source: text('import_source'),
  import_external_id: text('import_external_id'),
}, table => [
  primaryKey({ name: 'invoices_pkey', columns: [table.id] }),
  unique('invoices_workspace_id_entity_id_customer_id_id_key').on(table.workspace_id, table.entity_id, table.customer_id, table.id),
  unique('invoices_workspace_id_entity_id_document_number_key').on(table.workspace_id, table.entity_id, table.document_number),
  unique('invoices_workspace_id_entity_id_id_key').on(table.workspace_id, table.entity_id, table.id),
  unique('invoices_workspace_id_entity_id_period_key_sequence_number_key').on(table.workspace_id, table.entity_id, table.period_key, table.sequence_number),
]);
export type InvoicesRow = typeof invoices.$inferSelect;
export type NewInvoices = typeof invoices.$inferInsert;

export const payments = pgTable('payments', {
  id: uuid('id').notNull().default(sql`gen_random_uuid()`),
  workspace_id: uuid('workspace_id').notNull(),
  entity_id: uuid('entity_id').notNull(),
  invoice_id: uuid('invoice_id').notNull(),
  payment_date: date('payment_date').notNull(),
  amount: numeric('amount').notNull(),
  currency: text('currency').notNull().default(sql`'INR'::text`),
  method: text('method').notNull(),
  reference_number: text('reference_number'),
  notes: text('notes'),
  status: text('status').notNull().default(sql`'posted'::text`),
  posted_at: timestamp('posted_at', { withTimezone: true, mode: 'string' }).notNull().default(sql`now()`),
  posted_by: uuid('posted_by').notNull(),
  reversed_at: timestamp('reversed_at', { withTimezone: true, mode: 'string' }),
  reversed_by: uuid('reversed_by'),
  reversal_reason: text('reversal_reason'),
  import_source: text('import_source'),
  import_external_id: text('import_external_id'),
}, table => [
  primaryKey({ name: 'payments_pkey', columns: [table.id] }),
  unique('payments_workspace_id_entity_id_id_key').on(table.workspace_id, table.entity_id, table.id),
]);
export type PaymentsRow = typeof payments.$inferSelect;
export type NewPayments = typeof payments.$inferInsert;

export const placements = pgTable('placements', {
  id: uuid('id').notNull().default(sql`gen_random_uuid()`),
  workspace_id: uuid('workspace_id').notNull(),
  entity_id: uuid('entity_id').notNull(),
  code: text('code').notNull(),
  label: text('label').notNull(),
  sort_order: integer('sort_order').notNull().default(sql`0`),
  is_active: boolean('is_active').notNull().default(sql`true`),
  created_at: timestamp('created_at', { withTimezone: true, mode: 'string' }).notNull().default(sql`now()`),
  updated_at: timestamp('updated_at', { withTimezone: true, mode: 'string' }).notNull().default(sql`now()`),
  version: bigint('version', { mode: 'bigint' }).notNull().default(sql`1`),
  created_by: uuid('created_by'),
  updated_by: uuid('updated_by'),
}, table => [
  primaryKey({ name: 'placements_pkey', columns: [table.id] }),
  unique('placements_workspace_id_entity_id_code_key').on(table.workspace_id, table.entity_id, table.code),
  unique('placements_workspace_id_entity_id_id_key').on(table.workspace_id, table.entity_id, table.id),
]);
export type PlacementsRow = typeof placements.$inferSelect;
export type NewPlacements = typeof placements.$inferInsert;

export const print_types = pgTable('print_types', {
  id: uuid('id').notNull().default(sql`gen_random_uuid()`),
  workspace_id: uuid('workspace_id').notNull(),
  entity_id: uuid('entity_id').notNull(),
  code: text('code').notNull(),
  label: text('label').notNull(),
  sort_order: integer('sort_order').notNull().default(sql`0`),
  is_active: boolean('is_active').notNull().default(sql`true`),
  created_at: timestamp('created_at', { withTimezone: true, mode: 'string' }).notNull().default(sql`now()`),
  updated_at: timestamp('updated_at', { withTimezone: true, mode: 'string' }).notNull().default(sql`now()`),
  version: bigint('version', { mode: 'bigint' }).notNull().default(sql`1`),
  created_by: uuid('created_by'),
  updated_by: uuid('updated_by'),
}, table => [
  primaryKey({ name: 'print_types_pkey', columns: [table.id] }),
  unique('print_types_workspace_id_entity_id_code_key').on(table.workspace_id, table.entity_id, table.code),
  unique('print_types_workspace_id_entity_id_id_key').on(table.workspace_id, table.entity_id, table.id),
]);
export type PrintTypesRow = typeof print_types.$inferSelect;
export type NewPrintTypes = typeof print_types.$inferInsert;

export const report_exports = pgTable('report_exports', {
  id: uuid('id').notNull().default(sql`gen_random_uuid()`),
  workspace_id: uuid('workspace_id').notNull(),
  requested_by: uuid('requested_by').notNull(),
  report_type: text('report_type').notNull(),
  entity_ids: uuid('entity_ids').array().notNull(),
  filters_json: jsonb('filters_json').notNull(),
  as_of_date: date('as_of_date').notNull(),
  recorded_through: timestamp('recorded_through', { withTimezone: true, mode: 'string' }).notNull(),
  business_timezone: text('business_timezone').notNull(),
  report_definition_version: text('report_definition_version').notNull().default(sql`'v1'::text`),
  title_snapshot: text('title_snapshot').notNull(),
  entity_names_snapshot: jsonb('entity_names_snapshot').notNull(),
  format: text('format').notNull(),
  status: text('status').notNull().default(sql`'pending'::text`),
  bucket_id: text('bucket_id').notNull().default(sql`'report-exports'::text`),
  object_path: text('object_path'),
  sha256: text('sha256'),
  byte_size: bigint('byte_size', { mode: 'bigint' }),
  attempt_count: integer('attempt_count').notNull().default(sql`0`),
  lease_expires_at: timestamp('lease_expires_at', { withTimezone: true, mode: 'string' }),
  claim_token: uuid('claim_token'),
  next_attempt_at: timestamp('next_attempt_at', { withTimezone: true, mode: 'string' }).notNull().default(sql`now()`),
  last_error: text('last_error'),
  generated_at: timestamp('generated_at', { withTimezone: true, mode: 'string' }),
  expires_at: timestamp('expires_at', { withTimezone: true, mode: 'string' }),
  created_at: timestamp('created_at', { withTimezone: true, mode: 'string' }).notNull().default(sql`now()`),
  updated_at: timestamp('updated_at', { withTimezone: true, mode: 'string' }).notNull().default(sql`now()`),
  data_snapshot: jsonb('data_snapshot').notNull().default(sql`'{}'::jsonb`),
}, table => [
  primaryKey({ name: 'report_exports_pkey', columns: [table.id] }),
]);
export type ReportExportsRow = typeof report_exports.$inferSelect;
export type NewReportExports = typeof report_exports.$inferInsert;

export const styles = pgTable('styles', {
  id: uuid('id').notNull().default(sql`gen_random_uuid()`),
  workspace_id: uuid('workspace_id').notNull(),
  entity_id: uuid('entity_id').notNull(),
  style_number: text('style_number').notNull(),
  normalized_style_number: text('normalized_style_number'),
  name: text('name'),
  description: text('description'),
  default_print_type_id: uuid('default_print_type_id'),
  default_placement_id: uuid('default_placement_id'),
  default_unit_id: uuid('default_unit_id'),
  is_active: boolean('is_active').notNull().default(sql`true`),
  archived_at: timestamp('archived_at', { withTimezone: true, mode: 'string' }),
  created_at: timestamp('created_at', { withTimezone: true, mode: 'string' }).notNull().default(sql`now()`),
  updated_at: timestamp('updated_at', { withTimezone: true, mode: 'string' }).notNull().default(sql`now()`),
  version: bigint('version', { mode: 'bigint' }).notNull().default(sql`1`),
  created_by: uuid('created_by'),
  updated_by: uuid('updated_by'),
}, table => [
  primaryKey({ name: 'styles_pkey', columns: [table.id] }),
  unique('styles_workspace_id_entity_id_id_key').on(table.workspace_id, table.entity_id, table.id),
  unique('styles_workspace_id_entity_id_normalized_style_number_key').on(table.workspace_id, table.entity_id, table.normalized_style_number),
]);
export type StylesRow = typeof styles.$inferSelect;
export type NewStyles = typeof styles.$inferInsert;

export const tax_profiles = pgTable('tax_profiles', {
  id: uuid('id').notNull().default(sql`gen_random_uuid()`),
  workspace_id: uuid('workspace_id').notNull(),
  entity_id: uuid('entity_id').notNull(),
  name: text('name').notNull(),
  tax_mode: text('tax_mode').notNull(),
  cgst_rate: numeric('cgst_rate').notNull().default(sql`0`),
  sgst_rate: numeric('sgst_rate').notNull().default(sql`0`),
  igst_rate: numeric('igst_rate').notNull().default(sql`0`),
  other_tax_rate: numeric('other_tax_rate').notNull().default(sql`0`),
  is_active: boolean('is_active').notNull().default(sql`true`),
  version: bigint('version', { mode: 'bigint' }).notNull().default(sql`1`),
  created_at: timestamp('created_at', { withTimezone: true, mode: 'string' }).notNull().default(sql`now()`),
  updated_at: timestamp('updated_at', { withTimezone: true, mode: 'string' }).notNull().default(sql`now()`),
  created_by: uuid('created_by'),
  updated_by: uuid('updated_by'),
}, table => [
  primaryKey({ name: 'tax_profiles_pkey', columns: [table.id] }),
  unique('tax_profiles_workspace_id_entity_id_id_key').on(table.workspace_id, table.entity_id, table.id),
]);
export type TaxProfilesRow = typeof tax_profiles.$inferSelect;
export type NewTaxProfiles = typeof tax_profiles.$inferInsert;

export const units = pgTable('units', {
  id: uuid('id').notNull().default(sql`gen_random_uuid()`),
  workspace_id: uuid('workspace_id').notNull(),
  entity_id: uuid('entity_id').notNull(),
  code: text('code').notNull(),
  label: text('label').notNull(),
  sort_order: integer('sort_order').notNull().default(sql`0`),
  is_active: boolean('is_active').notNull().default(sql`true`),
  created_at: timestamp('created_at', { withTimezone: true, mode: 'string' }).notNull().default(sql`now()`),
  updated_at: timestamp('updated_at', { withTimezone: true, mode: 'string' }).notNull().default(sql`now()`),
  version: bigint('version', { mode: 'bigint' }).notNull().default(sql`1`),
  created_by: uuid('created_by'),
  updated_by: uuid('updated_by'),
}, table => [
  primaryKey({ name: 'units_pkey', columns: [table.id] }),
  unique('units_workspace_id_entity_id_code_key').on(table.workspace_id, table.entity_id, table.code),
  unique('units_workspace_id_entity_id_id_key').on(table.workspace_id, table.entity_id, table.id),
]);
export type UnitsRow = typeof units.$inferSelect;
export type NewUnits = typeof units.$inferInsert;

export const user_preferences = pgTable('user_preferences', {
  workspace_id: uuid('workspace_id').notNull(),
  user_id: uuid('user_id').notNull(),
  last_entity_id: uuid('last_entity_id'),
  skip_entity_selector: boolean('skip_entity_selector').notNull().default(sql`false`),
  preferences_json: jsonb('preferences_json').notNull().default(sql`'{}'::jsonb`),
  created_at: timestamp('created_at', { withTimezone: true, mode: 'string' }).notNull().default(sql`now()`),
  updated_at: timestamp('updated_at', { withTimezone: true, mode: 'string' }).notNull().default(sql`now()`),
}, table => [
  primaryKey({ name: 'user_preferences_pkey', columns: [table.workspace_id, table.user_id] }),
]);
export type UserPreferencesRow = typeof user_preferences.$inferSelect;
export type NewUserPreferences = typeof user_preferences.$inferInsert;

export const workspace_members = pgTable('workspace_members', {
  workspace_id: uuid('workspace_id').notNull(),
  user_id: uuid('user_id').notNull(),
  role: text('role').notNull(),
  created_at: timestamp('created_at', { withTimezone: true, mode: 'string' }).notNull().default(sql`now()`),
}, table => [
  primaryKey({ name: 'workspace_members_pkey', columns: [table.workspace_id, table.user_id] }),
]);
export type WorkspaceMembersRow = typeof workspace_members.$inferSelect;
export type NewWorkspaceMembers = typeof workspace_members.$inferInsert;

export const workspaces = pgTable('workspaces', {
  id: uuid('id').notNull().default(sql`gen_random_uuid()`),
  owner_user_id: uuid('owner_user_id').notNull(),
  name: text('name').notNull().default(sql`'Billing Workspace'::text`),
  created_at: timestamp('created_at', { withTimezone: true, mode: 'string' }).notNull().default(sql`now()`),
  updated_at: timestamp('updated_at', { withTimezone: true, mode: 'string' }).notNull().default(sql`now()`),
  timezone: text('timezone').notNull().default(sql`'Asia/Kolkata'::text`),
  default_currency: text('default_currency').notNull().default(sql`'INR'::text`),
}, table => [
  unique('workspaces_owner_user_id_key').on(table.owner_user_id),
  primaryKey({ name: 'workspaces_pkey', columns: [table.id] }),
]);
export type WorkspacesRow = typeof workspaces.$inferSelect;
export type NewWorkspaces = typeof workspaces.$inferInsert;
