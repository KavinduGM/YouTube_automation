import { redirect } from 'next/navigation';
import { apiGet, getMe } from '@/lib/api';
import TasksClient from './TasksClient';

interface Task {
  id: string;
  channelId: string;
  channel: { id: string; name: string; slug: string };
  rawFilename: string;
  rawTag: string;
  detectedType: 'long' | 'short' | null;
  detectedFormat: 'question' | 'animation' | null;
  durationMillis: number | null;
  status: string;
  contentItem: { id: string; expectedFilename: string; scheduledPublishAt: string; status: string; type: string; format: string | null } | null;
  assignedEditor: { id: string; username: string; name: string | null } | null;
  createdAt: string;
  submittedAt: string | null;
}

export default async function TasksPage({
  searchParams,
}: {
  searchParams: { status?: string; channelId?: string };
}) {
  const me = await getMe();
  if (!me?.user) redirect('/login');
  if (me.user.role !== 'admin') redirect('/');
  const qs = new URLSearchParams();
  if (searchParams.status) qs.set('status', searchParams.status);
  if (searchParams.channelId) qs.set('channelId', searchParams.channelId);
  const data = await apiGet<{ tasks: Task[] }>(`/tasks?${qs.toString()}`);
  return (
    <>
      <h1>Editor tasks</h1>
      <p className="muted">All raw uploads and their editing status.</p>
      <TasksClient initialTasks={data.tasks} initialStatus={searchParams.status ?? ''} />
    </>
  );
}
