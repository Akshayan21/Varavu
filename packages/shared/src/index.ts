import { z } from 'zod';

export const healthSchema = z.object({ status: z.literal('ok') });

export const workspaceProfileSchema = z.object({
  user: z.object({ id: z.uuid(), email: z.email() }),
  workspace: z.object({ id: z.uuid(), name: z.string() }),
});
export { billingEntityInput, customerInput } from './directory.js';
