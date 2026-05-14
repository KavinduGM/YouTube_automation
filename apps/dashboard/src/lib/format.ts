const TZ = process.env.TZ ?? 'America/New_York';

export function fmtDateTime(d: string | Date): string {
  const date = typeof d === 'string' ? new Date(d) : d;
  return new Intl.DateTimeFormat('en-US', {
    timeZone: TZ,
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date);
}

export function fmtDate(d: string | Date): string {
  const date = typeof d === 'string' ? new Date(d) : d;
  return new Intl.DateTimeFormat('en-US', {
    timeZone: TZ,
    dateStyle: 'medium',
  }).format(date);
}

export function statusBadge(status: string): string {
  switch (status) {
    case 'planned':          return 'bg-gray-200 text-gray-800';
    case 'uploaded':         return 'bg-blue-100 text-blue-800';
    case 'pending_approval': return 'bg-yellow-100 text-yellow-900';
    case 'approved':         return 'bg-emerald-100 text-emerald-800';
    case 'scheduling':       return 'bg-indigo-100 text-indigo-800';
    case 'scheduled':        return 'bg-teal-100 text-teal-800';
    case 'published':        return 'bg-green-200 text-green-900';
    case 'failed':           return 'bg-red-100 text-red-800';
    case 'rejected':         return 'bg-rose-100 text-rose-800';
    case 'canceled':         return 'bg-gray-100 text-gray-600';
    default:                 return 'bg-gray-100 text-gray-700';
  }
}
