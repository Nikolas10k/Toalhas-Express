import type { Metadata } from 'next';
import { requirePageActor } from '@/server/auth/guards';
import { MyData } from './my-data';

export const metadata: Metadata = { title: 'Meus dados' };

export default async function MyDataPage() {
  await requirePageActor('portal.access', '/portal/meus-dados');
  return <MyData />;
}
