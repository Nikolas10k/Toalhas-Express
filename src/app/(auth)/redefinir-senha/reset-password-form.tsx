'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { apiFetch, ApiError } from '@/lib/api-client';
import { updatePasswordSchema, type UpdatePasswordInput } from '@/lib/validation/auth';

export function ResetPasswordForm() {
  const router = useRouter();
  const form = useForm<UpdatePasswordInput>({ resolver: zodResolver(updatePasswordSchema), defaultValues: { password: '' } });
  const mutation = useMutation({
    mutationFn: (values: UpdatePasswordInput) => apiFetch('/api/auth/password/update', { body: values }),
    onSuccess: () => {
      toast.success('Senha atualizada.');
      router.replace('/');
    },
    onError: (err) => {
      if (err instanceof ApiError && err.code === 'MFA_REQUIRED') router.replace('/mfa?next=/redefinir-senha');
    },
  });
  const error = form.formState.errors.password;
  return (
    <form className="space-y-4" noValidate onSubmit={form.handleSubmit((v) => mutation.mutate(v))}>
      {mutation.error && (
        <Alert variant="destructive">
          {mutation.error instanceof ApiError ? mutation.error.message : 'Não foi possível atualizar.'}
        </Alert>
      )}
      <div className="space-y-2">
        <Label htmlFor="password">Nova senha</Label>
        <Input id="password" type="password" autoComplete="new-password" aria-invalid={Boolean(error)} {...form.register('password')} />
        {error && <p className="text-sm text-destructive">{error.message}</p>}
      </div>
      <Button type="submit" className="w-full" disabled={mutation.isPending}>
        {mutation.isPending ? 'Salvando…' : 'Salvar nova senha'}
      </Button>
    </form>
  );
}
