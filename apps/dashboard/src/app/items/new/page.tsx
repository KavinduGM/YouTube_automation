import { redirect } from 'next/navigation';
import { apiGet, getMe } from '@/lib/api';
import NewItemForm from './NewItemForm';

interface Channel { id: string; slug: string; name: string }

export default async function NewItemPage() {
  const me = await getMe();
  if (!me?.user) redirect('/login');
  const data = await apiGet<{ channels: Channel[] }>('/channels');
  return (
    <>
      <h1>New content item</h1>
      <p className="muted">Pre-fill metadata for an upcoming video. The system will match your editor's Drive upload by filename and put it here for approval.</p>
      <NewItemForm channels={data.channels} />
    </>
  );
}
