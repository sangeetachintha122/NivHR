export const formatDate = (value) => {
  if (!value) return '—';
  const day = typeof value === 'string' ? value.slice(0, 10) : new Date(value).toISOString().slice(0, 10);
  const [year, month, date] = day.split('-').map(Number);
  if (!year || !month || !date) return '—';
  return new Date(Date.UTC(year, month - 1, date)).toLocaleDateString('en-IN', {
    day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC',
  });
};

export const initials = (name = '') => name.trim().split(/\s+/).slice(0, 2).map((part) => part[0]).join('').toUpperCase() || 'U';

export const countWorkingDays = (fromDate, toDate) => {
  if (!fromDate || !toDate || fromDate > toDate) return 0;
  let days = 0;
  const cursor = new Date(`${fromDate}T00:00:00.000Z`);
  const end = new Date(`${toDate}T00:00:00.000Z`);
  while (cursor <= end) {
    const weekday = cursor.getUTCDay();
    if (weekday !== 0 && weekday !== 6) days += 1;
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return days;
};

export const leaveTypeLabel = (type = '') => type.charAt(0).toUpperCase() + type.slice(1).replaceAll('_', ' ');
