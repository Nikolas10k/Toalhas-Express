import { notFound, redirect } from 'next/navigation';
import { PageHeader } from '@/components/admin/page-header';
import { findNavItem } from '@/components/admin/nav-config';
import { Card, CardContent } from '@/components/ui/card';
import { getCurrentUserActor } from '@/server/auth/session';

/** Módulos do menu ainda não entregues: mostra em qual fase chegam. */
export default async function PlannedModulePage({ params }: { params: Promise<{ section: string[] }> }) {
  const { section } = await params;
  const href = `/admin/${section.join('/')}`;
  const item = findNavItem(href);
  if (!item) notFound();
  const actor = await getCurrentUserActor();
  if (!actor?.permissions.has(item.permission)) redirect('/sem-acesso');

  return (
    <>
      <PageHeader title={item.label} />
      <Card>
        <CardContent className="py-10 text-center">
          <p className="font-medium">Módulo em implementação</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Previsto para a Fase {item.phase} do plano de implementação.
          </p>
        </CardContent>
      </Card>
    </>
  );
}
