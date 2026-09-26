import type { Metadata } from 'next';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

export const metadata: Metadata = { title: 'Portal do cliente' };

export default function PortalHome() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Bem-vindo</CardTitle>
        <CardDescription>
          Em breve: próxima entrega, pedido atual, toalhas em posse e cobranças em aberto.
        </CardDescription>
      </CardHeader>
      <CardContent className="text-sm text-muted-foreground">Portal previsto a partir da Fase 2.</CardContent>
    </Card>
  );
}
