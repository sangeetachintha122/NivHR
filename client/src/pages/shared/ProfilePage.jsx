import { CalendarDays, Mail, ShieldCheck, UserRound } from 'lucide-react';
import { useAuth } from '../../context/AuthContext.jsx';
import { formatDate } from '../../utils/format.js';
import { Card, PageHeader, UserAvatar } from '../../components/common/Ui.jsx';

export default function ProfilePage() {
  const { user } = useAuth();
  const details = [
    { label: 'Full name', value: user.name, icon: UserRound },
    { label: 'Email address', value: user.email, icon: Mail },
    { label: 'Role', value: user.role === 'hr' ? 'HR' : 'Employee', icon: ShieldCheck },
    { label: 'Department', value: user.department || 'Not assigned', icon: CalendarDays },
    { label: 'Join date', value: formatDate(user.joinDate), icon: CalendarDays },
  ];
  return <>
    <PageHeader eyebrow="Account" title="Profile & settings" description="Your profile information comes from your NivHR account." />
    <div className="grid gap-5 lg:grid-cols-[.7fr_1.3fr]">
      <Card className="flex flex-col items-center p-7 text-center"><UserAvatar name={user.name} size="lg" /><h2 className="mt-4 text-lg font-bold text-[#263146]">{user.name}</h2><p className="mt-1 text-sm text-[#8791a3]">{user.email}</p><span className="mt-4 rounded-full bg-[#f0efff] px-3 py-1 text-[10px] font-bold uppercase tracking-[.1em] text-[#6557d9]">{user.role === 'hr' ? 'HR account' : 'Employee account'}</span><p className="mt-6 max-w-xs text-xs leading-5 text-[#929bad]">Profile editing is not available through the current backend.</p></Card>
      <Card className="p-5 sm:p-6"><h2 className="mb-5 text-sm font-bold text-[#2b3548]">Profile details</h2><div className="divide-y divide-[#eff0f4]">{details.map(({ label, value, icon: Icon }) => <div key={label} className="flex items-center gap-3 py-4 first:pt-0 last:pb-0"><span className="grid h-9 w-9 place-items-center rounded-xl bg-[#f6f6fa] text-[#778297]"><Icon className="h-4 w-4" /></span><div><p className="text-[10px] font-semibold uppercase tracking-[.1em] text-[#9aa2b1]">{label}</p><p className="mt-1 text-sm font-semibold text-[#3c475d]">{value || '—'}</p></div></div>)}</div></Card>
    </div>
  </>;
}
