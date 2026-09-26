import { redirect } from 'next/navigation';
import { homePathFor } from '@/server/auth/guards';
import { getCurrentUserActor, getSessionClaims } from '@/server/auth/session';

export default async function Home() {
  if (!(await getSessionClaims())) redirect('/login');
  const actor = await getCurrentUserActor();
  redirect(actor ? homePathFor(actor) : '/sem-acesso');
}
