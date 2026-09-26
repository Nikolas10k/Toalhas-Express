'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation } from '@tanstack/react-query';
import { MailCheck } from 'lucide-react';
import { useForm, useWatch } from 'react-hook-form';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { UFS } from '@/lib/br/address';
import { apiFetch, describeApiError } from '@/lib/api-client';
import { selfSignupSchema } from '@/lib/validation/customers';

interface Values {
  personType: 'PF' | 'PJ';
  legalName: string;
  tradeName: string;
  document: string;
  contactName: string;
  phone: string;
  whatsapp: string;
  email: string;
  password: string;
  postalCode: string;
  street: string;
  number: string;
  complement: string;
  district: string;
  city: string;
  state: string;
  whatsappOptIn: boolean;
  emailOptIn: boolean;
  acceptTerms: boolean;
}

export function SignupForm() {
  const form = useForm<Values>({
    resolver: zodResolver(selfSignupSchema as never) as never,
    defaultValues: {
      personType: 'PJ', legalName: '', tradeName: '', document: '', contactName: '', phone: '', whatsapp: '', email: '', password: '',
      postalCode: '', street: '', number: '', complement: '', district: '', city: '', state: '', whatsappOptIn: false, emailOptIn: false, acceptTerms: false,
    },
  });
  const mutation = useMutation({ mutationFn: (v: Values) => apiFetch<{ message: string }>('/api/public/signup', { body: v }) });
  const { register, formState: { errors }, control } = form;
  const pf = useWatch({ control, name: 'personType' }) === 'PF';

  if (mutation.isSuccess) {
    return (
      <div className="space-y-3 text-center">
        <MailCheck className="mx-auto size-10 text-primary" aria-hidden />
        <p className="font-medium">{mutation.data.message}</p>
      </div>
    );
  }

  const text = (id: keyof Values, label: string, props: React.InputHTMLAttributes<HTMLInputElement> = {}, required = false, className?: string) => (
    <Field id={id} label={label} required={required} error={errors[id]?.message as string | undefined} className={className ? `space-y-1.5 ${className}` : undefined}>
      <Input id={id} aria-invalid={Boolean(errors[id])} {...props} {...register(id)} />
    </Field>
  );

  return (
    <form noValidate onSubmit={form.handleSubmit((v) => mutation.mutate(v))} className="space-y-6">
      {mutation.error && <Alert variant="destructive">{describeApiError(mutation.error)}</Alert>}
      <div className="grid gap-4 sm:grid-cols-2">
        <Field id="personType" label="Tipo" required>
          <Select id="personType" {...register('personType')}>
            <option value="PJ">Empresa (CNPJ)</option>
            <option value="PF">Pessoa física (CPF)</option>
          </Select>
        </Field>
        {text('document', pf ? 'CPF' : 'CNPJ', { autoComplete: 'off' }, true)}
        {text('legalName', pf ? 'Nome completo' : 'Razão social', {}, true, 'sm:col-span-2')}
        {!pf && text('tradeName', 'Nome do estabelecimento', {}, false, 'sm:col-span-2')}
        {text('contactName', 'Responsável', { autoComplete: 'name' })}
        {text('whatsapp', 'WhatsApp', { type: 'tel', autoComplete: 'tel', placeholder: '(11) 98765-4321' })}
        {text('phone', 'Telefone', { type: 'tel', placeholder: '(11) 3333-4444' })}
      </div>
      <fieldset className="grid gap-4 sm:grid-cols-2">
        <legend className="mb-2 font-medium">Endereço de entrega</legend>
        {text('postalCode', 'CEP', { inputMode: 'numeric', autoComplete: 'postal-code' })}
        {text('street', 'Logradouro', { autoComplete: 'address-line1' })}
        {text('number', 'Número')}
        {text('complement', 'Complemento')}
        {text('district', 'Bairro')}
        {text('city', 'Cidade', { autoComplete: 'address-level2' })}
        <Field id="state" label="UF" error={errors.state?.message}>
          <Select id="state" {...register('state')}>
            <option value="">—</option>
            {UFS.map((u) => (
              <option key={u} value={u}>
                {u}
              </option>
            ))}
          </Select>
        </Field>
      </fieldset>
      <fieldset className="grid gap-4 sm:grid-cols-2">
        <legend className="mb-2 font-medium">Acesso ao portal</legend>
        {text('email', 'E-mail', { type: 'email', autoComplete: 'email' }, true)}
        {text('password', 'Senha', { type: 'password', autoComplete: 'new-password' }, true)}
        <p className="text-xs text-muted-foreground sm:col-span-2">Senha com 12+ caracteres, maiúsculas, minúsculas e números.</p>
      </fieldset>
      <div className="space-y-2 text-sm">
        <label className="flex items-start gap-2">
          <input type="checkbox" className="mt-0.5 size-4" {...register('whatsappOptIn')} /> Quero receber avisos de entrega e cobrança pelo WhatsApp.
        </label>
        <label className="flex items-start gap-2">
          <input type="checkbox" className="mt-0.5 size-4" {...register('emailOptIn')} /> Quero receber avisos por e-mail.
        </label>
        <label className="flex items-start gap-2">
          <input type="checkbox" className="mt-0.5 size-4" aria-invalid={Boolean(errors.acceptTerms)} {...register('acceptTerms')} />
          <span>
            Li e aceito os termos de uso e a política de privacidade. Meus dados serão usados apenas para prestação do serviço.
          </span>
        </label>
        {errors.acceptTerms && <p className="text-destructive">{errors.acceptTerms.message}</p>}
      </div>
      <Button type="submit" className="w-full" disabled={mutation.isPending}>
        {mutation.isPending ? 'Enviando…' : 'Criar cadastro'}
      </Button>
    </form>
  );
}
