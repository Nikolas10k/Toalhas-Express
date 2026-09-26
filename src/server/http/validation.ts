import type { ZodError } from 'zod';
import type { FieldIssue } from '@/server/core/errors';

export function zodIssues(error: ZodError): FieldIssue[] {
  return error.issues.slice(0, 50).map((i) => ({
    path: i.path.map(String).join('.') || '(root)',
    message: i.message,
  }));
}
