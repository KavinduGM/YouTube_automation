import { redirect } from 'next/navigation';
import { apiGet, getMe } from '@/lib/api';
import UsersClient from './UsersClient';

interface User {
  id: string;
  username: string;
  email: string | null;
  name: string | null;
  role: 'admin' | 'editor';
  active: boolean;
  createdAt: string;
}

export default async function UsersPage() {
  const me = await getMe();
  if (!me?.user) redirect('/login');
  if (me.user.role !== 'admin') redirect('/');
  const data = await apiGet<{ users: User[] }>('/users');
  return (
    <>
      <h1>Users</h1>
      <p className="muted">Admins manage the system. Editors only see their assigned video tasks.</p>
      <UsersClient initialUsers={data.users} myId={me.user.id} />
    </>
  );
}
