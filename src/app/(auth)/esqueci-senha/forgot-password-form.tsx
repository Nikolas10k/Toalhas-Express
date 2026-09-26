'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation } from '@tanstack/react-query';
import Link from 'next/link';
import { useForm } from 'react-hook-form';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { apiFetch, ApiError } from '@/lib/api-client';
import { forgotPasswordSchema, type ForgotPasswordInput } from '@/lib/validation/auth';

export function ForgotPasswordForm() {
  const form = useForm<ForgotPasswordInput>({ resolver: zodResolver(forgotPasswordSchema), defaultValues: { email: '' } });
  const mutation = useMutation({
    mutationFn: (values: ForgotPasswordInput) =>
      apiFetch<{ message: string }>('/api/auth/password/forgot', { body: values }),
  });

  if (mutation.isSuccess) {
    return (
      <div className="space-y-4">
        <Alert>{mutation.data.message}</Alert>
        <Link href="/login" className="text-sm text-primary hover:underline">
          Voltar para o login
        </Link>
      </div>
    );
  }

  const error = form.formState.errors.email;
  return (
    <form className="space-y-4" noValidate onSubmit={form.handleSubmit((v) => mutation.mutate(v))}>
      {mutation.error && (
        <Alert variant="destructive">
          {mutation.error instanceof ApiError ? mutation.error.message : 'Não foi possível enviar.'}
        </Alert>
      )}
      <div className="space-y-2">
        <Label htmlFor="email">E-mail</Label>
        <Input id="email" type="email" autoComplete="email" aria-invalid={Boolean(error)} {...form.register('email')} />
        {error && <p className="text-sm text-destructive">{error.message}</p>}
      </div>
      <Button type="submit" className="w-full" disabled={mutation.isPending}>
        {mutation.isPending ? 'Enviando…' : 'Enviar link'}
      </Button>
      <Link href="/login" className="block text-center text-sm text-primary hover:underline">
        Voltar para o login
      </Link>
    </form>
  );
}
