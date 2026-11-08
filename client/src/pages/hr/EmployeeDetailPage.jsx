import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, Building2, CalendarDays, Mail, Pencil, ShieldCheck } from 'lucide-react';
import { api, getErrorMessage } from '../../api/client.js';
import { formatDate } from '../../utils/format.js';
import { Button, Card, InlineError, LoadingInline, PageHeader, StatusBadge, UserAvatar } from '../../components/common/Ui.jsx';
import EmployeeFormModal from '../../components/employees/EmployeeFormModal.jsx';

export default function EmployeeDetailPage() {
  const { id } = useParams();
  const [employee, setEmployee] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState(false);
  const load = useCallback(async () => {
    setLoading(true); setError('');
    try { const { data } = await api.get(`/employees/${id}`); setEmployee(data.employee); }
    catch (requestError) { setError(getErrorMessage(requestError)); }
    finally { setLoading(false); }
  }, [id]);
  useEffect(() => { load(); }, [load]);

  if (loading && !employee) return <LoadingInline label="Loading employee profile" />;
  return <>
    <PageHeader eyebrow="People directory" title={employee?.name || 'Employee profile'} description="Employee profile details and account status." actions={<><Link to="/employees"><Button variant="secondary"><ArrowLeft className="h-4 w-4" />Back to employees</Button></Link>{employee && <Button onClick={() => setEditing(true)}><Pencil className="h-4 w-4" />Edit profile</Button>}</>} />
    {error && <div className="mb-5"><InlineError message={error} onRetry={load} /></div>}
    {employee && <div className="grid gap-5 lg:grid-cols-[.8fr_1.2fr]">
      <Card className="p-6"><div className="flex flex-col items-center text-center"><UserAvatar name={employee.name} size="lg" /><h2 className="mt-4 text-lg font-bold text-[#263146]">{employee.name}</h2><p className="mt-1 text-sm text-[#8791a3]">{employee.department || 'Department not set'}</p><div className="mt-3"><StatusBadge status={employee.isActive ? 'active' : 'inactive'} /></div></div><div className="mt-7 border-t border-[#eff0f4] pt-5"><p className="mb-3 text-[10px] font-bold uppercase tracking-[.13em] text-[#a0a7b5]">Account details</p><div className="space-y-4"><ProfileLine icon={Mail} label="Work email" value={employee.email} /><ProfileLine icon={ShieldCheck} label="Role" value="Employee" /><ProfileLine icon={CalendarDays} label="Join date" value={formatDate(employee.joinDate)} /><ProfileLine icon={Building2} label="Department" value={employee.department || 'Not assigned'} /></div></div></Card>
      <Card className="p-6"><div className="mb-5"><h3 className="text-sm font-bold text-[#2b3548]">Profile overview</h3><p className="mt-1 text-xs text-[#929bad]">This profile is sourced from the employee record.</p></div><div className="grid gap-4 sm:grid-cols-2"><ProfileTile label="Employee name" value={employee.name} /><ProfileTile label="Email address" value={employee.email} /><ProfileTile label="Department" value={employee.department || 'Not assigned'} /><ProfileTile label="Joined NivHR" value={formatDate(employee.joinDate)} /><ProfileTile label="Account created" value={formatDate(employee.createdAt)} /><ProfileTile label="Last updated" value={formatDate(employee.updatedAt)} /></div></Card>
    </div>}
    {editing && employee && <EmployeeFormModal employee={employee} onClose={() => setEditing(false)} onSaved={(updated) => { setEmployee(updated); setEditing(false); }} />}
  </>;
}

function ProfileLine({ icon: Icon, label, value }) {
  return <div className="flex items-center gap-3"><span className="grid h-8 w-8 place-items-center rounded-xl bg-[#f5f5fa] text-[#818ba0]"><Icon className="h-4 w-4" /></span><span className="min-w-0"><span className="block text-[10px] text-[#9aa2b1]">{label}</span><span className="block truncate text-xs font-semibold text-[#495469]">{value}</span></span></div>;
}

function ProfileTile({ label, value }) {
  return <div className="rounded-xl border border-[#eff0f4] bg-[#fcfcfd] p-4"><p className="text-[10px] font-semibold uppercase tracking-[.1em] text-[#9aa2b1]">{label}</p><p className="mt-2 text-sm font-semibold text-[#394459]">{value || '—'}</p></div>;
}
