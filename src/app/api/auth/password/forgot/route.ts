import { forgotPasswordSchema } from '@/lib/validation/auth';
import { route } from '@/server/http/route';
import { requestPasswordReset } from '@/server/modules/auth/auth.service';

export const POST = route({
  auth: 'public',
  body: forgotPasswordSchema,
  maxBodyBytes: 2 * 1024,
  handler: async ({ body }) => {
    await requestPasswordReset(body);
    // Resposta idêntica exista ou não a conta (anti-enumeração).
    return { message: 'Se o e-mail estiver cadastrado, você receberá um link para redefinir a senha.' };
  },
});
