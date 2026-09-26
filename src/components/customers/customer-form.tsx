'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useForm, useWatch, type FieldErrors, type UseFormRegister } from 'react-hook-form';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { UFS } from '@/lib/br/address';
import {
  customerCreateSchema,
  customerUpdateSchema,
  type CustomerCreateData,
  type CustomerUpdateData,
} from '@/lib/validation/customers';
import { CHANNEL_LABEL } from './labels';

export interface CustomerFormValues {
  personType: 'PF' | 'PJ';
  legalName: string;
  tradeName: string;
  document: string;
  contactName: string;
  phone: string;
  whatsapp: string;
  email: string;
  postalCode: string;
  street: string;
  number: string;
  complement: string;
  district: string;
  city: string;
  state: string;
  preferredChannel: 'WHATSAPP' | 'EMAIL' | 'PHONE' | 'NONE';
  whatsappOptIn: boolean;
  emailOptIn: boolean;
  notes: string;
}

export const EMPTY_CUSTOMER: CustomerFormValues = {
  personType: 'PJ',
  legalName: '',
  tradeName: '',
  document: '',
  contactName: '',
  phone: '',
  whatsapp: '',
  email: '',
  postalCode: '',
  street: '',
  number: '',
  complement: '',
  district: '',
  city: '',
  state: '',
  preferredChannel: 'WHATSAPP',
  whatsappOptIn: false,
  emailOptIn: false,
  notes: '',
};

type Props =
  | { mode: 'create'; defaultValues?: Partial<CustomerFormValues>; onSubmit: (v: CustomerCreateData) => void; pending: boolean; error?: string | null }
  | { mode: 'edit'; defaultValues: CustomerFormValues; onSubmit: (v: CustomerUpdateData) => void; pending: boolean; error?: string | null };

export function CustomerForm(props: Props) {
  const isEdit = props.mode === 'edit';
  const form = useForm<CustomerFormValues>({
    // Resolver valida e NORMALIZA com o mesmo schema da API.
    resolver: (isEdit
      ? (values: CustomerFormValues, ctx: unknown, opts: never) => {
          // Documento e tipo não são editáveis: ficam fora do schema estrito de edição.
          const { personType: _p, document: _d, ...rest } = values;
          return zodResolver(customerUpdateSchema)(rest as never, ctx, opts);
        }
      : zodResolver(customerCreateSchema)) as never,
    defaultValues: { ...EMPTY_CUSTOMER, ...props.defaultValues },
  });
  const { register, formState, control } = form;
  const errors = formState.errors;
  const personType = useWatch({ control, name: 'personType' });

  const submit = form.handleSubmit((values) => {
    if (props.mode === 'create') props.onSubmit(values as unknown as CustomerCreateData);
    else {
      // Na edição só enviamos o que mudou (patch).
      const dirty = Object.keys(formState.dirtyFields) as (keyof CustomerFormValues)[];
      const patch = Object.fromEntries(dirty.map((k) => [k, (values as unknown as Record<string, unknown>)[k]]));
      props.onSubmit(patch as CustomerUpdateData);
    }
  });

  return (
    <form onSubmit={submit} noValidate className="space-y-8">
      {props.error && <Alert variant="destructive">{props.error}</Alert>}

      <Section title="Identificação">
        <Field id="personType" label="Tipo" required>
          <Select id="personType" disabled={isEdit} {...register('personType')}>
            <option value="PJ">Pessoa jurídica (CNPJ)</option>
            <option value="PF">Pessoa física (CPF)</option>
          </Select>
        </Field>
        <TextField id="document" label={personType === 'PF' ? 'CPF' : 'CNPJ'} required disabled={isEdit} register={register} errors={errors} inputMode="text" autoComplete="off" />
        <TextField id="legalName" label={personType === 'PF' ? 'Nome completo' : 'Razão social'} required register={register} errors={errors} className="sm:col-span-2" />
        <TextField id="tradeName" label="Nome fantasia" register={register} errors={errors} className="sm:col-span-2" />
      </Section>

      <Section title="Contato">
        <TextField id="contactName" label="Responsável" register={register} errors={errors} />
        <TextField id="email" label="E-mail" type="email" register={register} errors={errors} />
        <TextField id="phone" label="Telefone" type="tel" placeholder="(11) 3333-4444" register={register} errors={errors} />
        <TextField id="whatsapp" label="WhatsApp" type="tel" placeholder="(11) 98765-4321" register={register} errors={errors} />
      </Section>

      <Section title="Endereço" description="Usado para localizar o cliente no mapa e planejar rotas.">
        <TextField id="postalCode" label="CEP" inputMode="numeric" placeholder="00000-000" register={register} errors={errors} />
        <TextField id="street" label="Logradouro" register={register} errors={errors} className="sm:col-span-2" />
        <TextField id="number" label="Número" register={register} errors={errors} />
        <TextField id="complement" label="Complemento" register={register} errors={errors} />
        <TextField id="district" label="Bairro" register={register} errors={errors} />
        <TextField id="city" label="Cidade" register={register} errors={errors} />
        <Field id="state" label="UF" error={errors.state?.message}>
          <Select id="state" aria-invalid={Boolean(errors.state)} {...register('state')}>
            <option value="">—</option>
            {UFS.map((uf) => (
              <option key={uf} value={uf}>
                {uf}
              </option>
            ))}
          </Select>
        </Field>
      </Section>

      <Section title="Comunicação" description="Mensagens automáticas só são enviadas com consentimento registrado.">
        <Field id="preferredChannel" label="Canal preferido">
          <Select id="preferredChannel" {...register('preferredChannel')}>
            {Object.entries(CHANNEL_LABEL).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </Select>
        </Field>
        <div className="flex flex-col justify-end gap-2 text-sm">
          <label className="flex items-center gap-2">
            <input type="checkbox" className="size-4" {...register('whatsappOptIn')} /> Autoriza mensagens por WhatsApp
          </label>
          <label className="flex items-center gap-2">
            <input type="checkbox" className="size-4" {...register('emailOptIn')} /> Autoriza mensagens por e-mail
          </label>
        </div>
      </Section>

      <Section title="Observações">
        <Field id="notes" label="Observações internas" error={errors.notes?.message} className="space-y-1.5 sm:col-span-2">
          <Textarea id="notes" rows={3} {...register('notes')} />
        </Field>
      </Section>

      <div className="flex justify-end gap-2">
        <Button type="submit" disabled={props.pending || (isEdit && !formState.isDirty)}>
          {props.pending ? 'Salvando…' : isEdit ? 'Salvar alterações' : 'Cadastrar cliente'}
        </Button>
      </div>
    </form>
  );
}

function Section({ title, description, children }: { title: string; description?: string; children: React.ReactNode }) {
  return (
    <fieldset className="space-y-3">
      <legend className="mb-2 font-medium">
        {title}
        {description && <span className="block text-sm font-normal text-muted-foreground">{description}</span>}
      </legend>
      <div className="grid gap-4 sm:grid-cols-2">{children}</div>
    </fieldset>
  );
}

function TextField({
  id,
  label,
  register,
  errors,
  required,
  className,
  ...inputProps
}: {
  id: keyof CustomerFormValues;
  label: string;
  register: UseFormRegister<CustomerFormValues>;
  errors: FieldErrors<CustomerFormValues>;
  required?: boolean;
  className?: string;
} & Omit<React.InputHTMLAttributes<HTMLInputElement>, 'id'>) {
  const error = errors[id]?.message as string | undefined;
  return (
    <Field id={id} label={label} required={required} error={error} className={className ? `space-y-1.5 ${className}` : undefined}>
      <Input id={id} aria-invalid={Boolean(error)} aria-describedby={error ? `${id}-error` : undefined} {...inputProps} {...register(id)} />
    </Field>
  );
}
