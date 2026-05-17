import { redirect } from 'next/navigation';
import { getMe } from '@/lib/api';

export default async function Home() {
  const me = await getMe();
  if (!me?.user) redirect('/login');
  if (me.user.role === 'editor') redirect('/editor/tasks');
  redirect('/inbox');
}
