import type { FastifyReply } from 'fastify';

export function databaseError(reply: FastifyReply, error: { code: string; message: string }) {
  const statuses: Record<string, number> = {
    '42501': 403, '23505': 409, '40001': 409, '40P01': 409, '55P03': 409,
    'P0002': 404, '23514': 400, '23502': 400, '23503': 409,
    '22P02': 400, '22003': 400, '22007': 400, '22008': 400,
    '22023': 400, '22001': 400,
  };
  const status = statuses[error.code] ?? 503;
  if (status === 503) reply.header('Retry-After', '5');
  const message = status === 503 ? 'Database operation unavailable. Please retry.'
    : error.code === '23503' ? 'A referenced record is unavailable or still in use.'
    : error.code === '23502' ? 'A required value is missing.'
    : error.code === '22P02' ? 'A submitted value has an invalid format.'
    : error.code === 'P0002' ? 'Record not found.'
    : error.message;
  return reply.code(status).send({ error: message, code: error.code, requestId: reply.request.id });
}
