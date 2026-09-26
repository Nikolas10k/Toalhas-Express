'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation } from '@tanstack/react-query';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { apiFetch, ApiError } from '@/lib/api-client';
import { loginSchema, type LoginInput } from '@/lib/validation/auth';

export function LoginForm({ next }: { next: string }) {
  const router = useRouter();
  const form = useForm<LoginInput>({ resolver: zodResolver(loginSchema), defaultValues: { email: '', password: '' } });
  const mutation = useMutation({
    mutationFn: (values: LoginInput) =>
      apiFetch<{ next: 'mfa_verify' | 'mfa_enroll' | 'done' }>('/api/auth/login', { body: values }),
    onSuccess: ({ next: step }) => {
      router.replace(step === 'done' ? next : `/mfa?next=${encodeURIComponent(next)}`);
      router.refresh();
    },
  });

  const errors = form.formState.errors;
  return (
    <form className="space-y-4" noValidate onSubmit={form.handleSubmit((v) => mutation.mutate(v))}>
      {mutation.error && (
        <Alert variant="destructive">
          {mutation.error instanceof ApiError ? mutation.error.message : 'Não foi possível entrar.'}
        </Alert>
      )}
      <div className="space-y-2">
        <Label htmlFor="email">E-mail</Label>
        <Input
          id="email"
          type="email"
          autoComplete="username"
          aria-invalid={Boolean(errors.email)}
          aria-describedby={errors.email ? 'email-error' : undefined}
          {...form.register('email')}
        />
        {errors.email && (
          <p id="email-error" className="text-sm text-destructive">
            {errors.email.message}
          </p>
        )}
      </div>
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label htmlFor="password">Senha</Label>
          <Link href="/esqueci-senha" className="text-sm text-primary hover:underline">
            Esqueci minha senha
          </Link>
        </div>
        <Input
          id="password"
          type="password"
          autoComplete="current-password"
          aria-invalid={Boolean(errors.password)}
          aria-describedby={errors.password ? 'password-error' : undefined}
          {...form.register('password')}
        />
        {errors.password && (
          <p id="password-error" className="text-sm text-destructive">
            {errors.password.message}
          </p>
        )}
      </div>
      <Button type="submit" className="w-full" disabled={mutation.isPending}>
        {mutation.isPending ? 'Entrando…' : 'Entrar'}
      </Button>
    </form>
  );
}
