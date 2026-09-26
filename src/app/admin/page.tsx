import type { Metadata } from 'next';
import { PageHeader } from '@/components/admin/page-header';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

export const metadata: Metadata = { title: 'Dashboard' };

const CARDS = [
  { title: 'Pedidos do dia', phase: 4 },
  { title: 'Entregas e coletas', phase: 6 },
  { title: 'Rotas ativas', phase: 5 },
  { title: 'Estoque por estado', phase: 3 },
  { title: 'Perdas e danos', phase: 6 },
  { title: 'Faturamento e recebimentos', phase: 9 },
  { title: 'Vencidos e inadimplentes', phase: 9 },
  { title: 'Alertas operacionais', phase: 12 },
];

export default function AdminDashboard() {
  return (
    <>
      <PageHeader title="Dashboard" description="Visão geral da operação." />
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {CARDS.map((c) => (
          <Card key={c.title}>
            <CardHeader>
              <CardTitle className="text-base">{c.title}</CardTitle>
              <CardDescription>Indicador disponível a partir da Fase {c.phase}.</CardDescription>
            </CardHeader>
            <CardContent>
              <p className="text-3xl font-semibold text-muted-foreground" aria-label="Sem dados">
                —
              </p>
            </CardContent>
          </Card>
        ))}
      </div>
    </>
  );
}
