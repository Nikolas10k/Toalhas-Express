import type { Metadata } from 'next';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { ResetPasswordForm } from './reset-password-form';

export const metadata: Metadata = { title: 'Definir nova senha' };

export default function ResetPasswordPage() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Definir nova senha</CardTitle>
        <CardDescription>Mínimo de 12 caracteres, com maiúsculas, minúsculas e números.</CardDescription>
      </CardHeader>
      <CardContent>
        <ResetPasswordForm />
      </CardContent>
    </Card>
  );
}
