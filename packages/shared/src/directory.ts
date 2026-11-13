import { z } from 'zod';

const shortText = z.string().trim().max(200).nullable().optional();
const address = z.record(z.string().max(64), z.string().trim().max(300));
const days = z.number().int().min(0).max(365);
const common = z.object({
  legal_name: z.string().trim().min(1).max(200),
  display_name: shortText,
  billing_address: address.optional(),
  email: z.email().max(254).nullable().optional(),
  phone: shortText,
  gstin: z.string().trim().toUpperCase().regex(/^[A-Z0-9]{15}$/).nullable().optional(),
  state_code: shortText,
  is_active: z.boolean().optional(),
}).strict();

export const billingEntityInput = common.extend({
  entity_code: z.string().trim().toUpperCase().regex(/^[A-Z0-9_-]{1,24}$/),
  gst_registered: z.boolean().optional(),
  pan: shortText,
  bank_details: address.optional(),
  upi_id: shortText,
  payment_instructions: z.string().trim().max(2000).nullable().optional(),
  invoice_prefix: shortText,
  default_due_days: days.optional(),
  financial_year_start_month: z.number().int().min(1).max(12).optional(),
  dc_prefix: shortText,
  numbering_mode: z.enum(['financial_year','continuous']).optional(),
  default_terms: z.string().trim().max(2000).nullable().optional(),
  rounding_increment: z.union([z.literal(0),z.literal(0.01),z.literal(1)]).optional(),
});

export const customerInput = common.extend({
  shipping_address: address.nullable().optional(),
  contact_name: shortText,
  contact_phone: shortText,
  country: shortText,
  payment_terms_days: days.nullable().optional(),
  notes: z.string().trim().max(4000).nullable().optional(),
});
