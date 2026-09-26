'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { apiFetch, ApiError } from '@/lib/api-client';
import { totpCodeSchema } from '@/lib/validation/auth';

const schema = z.object({ code: totpCodeSchema });
type Values = z.infer<typeof schema>;

export function MfaVerifyForm({ next, factorId }: { next: string; factorId?: string }) {
  const router = useRouter();
  const form = useForm<Values>({ resolver: zodResolver(schema), defaultValues: { code: '' } });
  const mutation = useMutation({
    mutationFn: (values: Values) => apiFetch('/api/auth/mfa/verify', { body: { code: values.code, factorId } }),
    onSuccess: () => {
      router.replace(next);
      router.refresh();
    },
    onSettled: () => form.reset({ code: '' }),
  });
  const error = form.formState.errors.code;
  return (
    <form className="space-y-4" noValidate onSubmit={form.handleSubmit((v) => mutation.mutate(v))}>
      {mutation.error && (
        <Alert variant="destructive">
          {mutation.error instanceof ApiError ? mutation.error.message : 'Não foi possível verificar.'}
        </Alert>
      )}
      <div className="space-y-2">
        <Label htmlFor="code">Código</Label>
        <Input
          id="code"
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={6}
          className="text-center text-lg tracking-[0.5em]"
          aria-invalid={Boolean(error)}
          {...form.register('code')}
        />
        {error && <p className="text-sm text-destructive">{error.message}</p>}
      </div>
      <Button type="submit" className="w-full" disabled={mutation.isPending}>
        {mutation.isPending ? 'Verificando…' : 'Verificar'}
      </Button>
    </form>
  );
}
