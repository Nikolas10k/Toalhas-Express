import type { Metadata } from 'next';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

export const metadata: Metadata = { title: 'App do motorista' };

export default function DriverHome() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Rota do dia</CardTitle>
        <CardDescription>Nenhuma rota atribuída.</CardDescription>
      </CardHeader>
      <CardContent className="text-sm text-muted-foreground">App do motorista previsto para a Fase 5.</CardContent>
    </Card>
  );
}
