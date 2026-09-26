import { z } from 'zod';

/** Schemas compartilhados entre formulários (client) e API (server). */
export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .max(254)
  .pipe(z.email({ message: 'Informe um e-mail válido.' }));

export const loginSchema = z.strictObject({
  email: emailSchema,
  password: z.string().min(1, 'Informe a senha.').max(200),
});
export type LoginInput = z.infer<typeof loginSchema>;

export const forgotPasswordSchema = z.strictObject({ email: emailSchema });
export type ForgotPasswordInput = z.infer<typeof forgotPasswordSchema>;

export const newPasswordSchema = z
  .string()
  .min(12, 'Use pelo menos 12 caracteres.')
  .max(200)
  .refine((v) => /[a-z]/.test(v) && /[A-Z]/.test(v) && /\d/.test(v), {
    message: 'Use letras maiúsculas, minúsculas e números.',
  });

export const updatePasswordSchema = z.strictObject({ password: newPasswordSchema });
export type UpdatePasswordInput = z.infer<typeof updatePasswordSchema>;

export const totpCodeSchema = z.string().trim().regex(/^\d{6}$/, 'O código tem 6 dígitos.');

export const mfaVerifySchema = z.strictObject({
  factorId: z.uuid().optional(),
  code: totpCodeSchema,
});
export type MfaVerifyInput = z.infer<typeof mfaVerifySchema>;
