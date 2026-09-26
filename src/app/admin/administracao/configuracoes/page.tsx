import type { Metadata } from 'next';
import { PageHeader } from '@/components/admin/page-header';
import { requirePageActor } from '@/server/auth/guards';
import { SettingsForm } from './settings-form';

export const metadata: Metadata = { title: 'Configurações' };

export default async function SettingsPage() {
  const actor = await requirePageActor('organization.read', '/admin/administracao/configuracoes');
  return (
    <>
      <PageHeader title="Configurações" description="Regras da organização. Alterações exigem confirmação com o autenticador e ficam na auditoria." />
      <SettingsForm canManage={actor.permissions.has('organization.manage')} />
    </>
  );
}
