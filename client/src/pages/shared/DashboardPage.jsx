import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Bar, BarChart, CartesianGrid, Cell, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { ArrowRight, BriefcaseBusiness, CalendarCheck2, CalendarClock, CalendarDays, CirclePlus, Clock3, Users, WandSparkles } from 'lucide-react';
import { api, getErrorMessage } from '../../api/client.js';
import { getAllEmployees, getAllMyLeaves } from '../../api/resources.js';
import { useAuth } from '../../context/AuthContext.jsx';
import { formatDate, leaveTypeLabel } from '../../utils/format.js';
import { Button, Card, EmptyState, InlineError, LoadingInline, PageHeader, StatusBadge } from '../../components/common/Ui.jsx';

const chartColors = ['#675ad8', '#26a269', '#e4a33b', '#d9677c'];

function MetricCard({ label, value, note, icon: Icon, tint = 'violet' }) {
  const tintClass = {
    violet: 'bg-[#f1efff] text-[#695cda]', green: 'bg-[#e9f7ef] text-[#248b59]', amber: 'bg-[#fff6e8] text-[#bf8322]', blue: 'bg-[#edf4ff] text-[#4e79bf]',
  }[tint];
  return <Card className="p-5"><div className="flex items-start justify-between gap-3"><div><p className="text-xs font-semibold text-[#7e889b]">{label}</p><p className="mt-3 text-[30px] font-bold tracking-[-.05em] text-[#202a3b]">{value}</p><p className="mt-1 text-[11px] text-[#a0a7b5]">{note}</p></div><div className={`grid h-10 w-10 place-items-center rounded-xl ${tintClass}`}><Icon className="h-[18px] w-[18px]" /></div></div></Card>;
}

function HRDashboard({ user }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const [employeeData, recentLeaves, pending, approved, rejected] = await Promise.all([
        getAllEmployees(),
        api.get('/leaves', { params: { page: 1, limit: 6 } }),
        api.get('/leaves', { params: { status: 'pending', page: 1, limit: 1 } }),
        api.get('/leaves', { params: { status: 'approved', page: 1, limit: 1 } }),
        api.get('/leaves', { params: { status: 'rejected', page: 1, limit: 1 } }),
      ]);
      const departments = new Map();
      employeeData.employees.filter((employee) => employee.isActive).forEach((employee) => {
        const key = employee.department?.trim() || 'Unassigned';
        departments.set(key, (departments.get(key) || 0) + 1);
      });
      setData({
        employees: employeeData.employees,
        totalEmployees: employeeData.pagination?.total || employeeData.employees.length,
        activeEmployees: employeeData.employees.filter((employee) => employee.isActive).length,
        departments: [...departments.entries()].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count).slice(0, 6),
        recentLeaves: recentLeaves.data.leaves || [],
        pendingCount: pending.data.pagination?.total || 0,
        approvedCount: approved.data.pagination?.total || 0,
        rejectedCount: rejected.data.pagination?.total || 0,
      });
    } catch (requestError) { setError(getErrorMessage(requestError)); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);
  const leaveStatuses = useMemo(() => data ? [
    { name: 'Pending', value: data.pendingCount },
    { name: 'Approved', value: data.approvedCount },
    { name: 'Rejected', value: data.rejectedCount },
  ] : [], [data]);

  return <>
    <PageHeader eyebrow="Your workspace" title={`Welcome back, ${user.name.split(' ')[0]}`} description="A clear view of your people operations today." actions={<Button variant="secondary" onClick={load} disabled={loading}><Clock3 className="h-4 w-4" />Refresh</Button>} />
    {error && <div className="mb-5"><InlineError message={error} onRetry={load} /></div>}
    {loading && !data ? <LoadingInline label="Loading your workspace" /> : data && <>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard label="Total employees" value={data.totalEmployees} note="Employee accounts" icon={Users} tint="violet" />
        <MetricCard label="Active employees" value={data.activeEmployees} note="Currently active" icon={BriefcaseBusiness} tint="green" />
        <MetricCard label="Pending leave" value={data.pendingCount} note="Awaiting your review" icon={CalendarClock} tint="amber" />
        <MetricCard label="Approved leaves" value={data.approvedCount} note="All time" icon={CalendarCheck2} tint="blue" />
      </div>
      <div className="mt-6 grid gap-5 xl:grid-cols-[1.35fr_.9fr]">
        <Card className="p-5 sm:p-6"><div className="mb-5 flex items-start justify-between"><div><h2 className="text-sm font-bold text-[#2b3548]">Active employees by department</h2><p className="mt-1 text-xs text-[#929bad]">Based on active employee records</p></div><span className="rounded-lg bg-[#f3f2ff] p-2 text-[#6659d3]"><Users className="h-4 w-4" /></span></div>
          {data.departments.length ? <div className="h-[270px] w-full"><ResponsiveContainer width="100%" height="100%"><BarChart data={data.departments} margin={{ top: 8, right: 4, left: -20, bottom: 4 }}><CartesianGrid vertical={false} stroke="#edf0f4" /><XAxis dataKey="name" tickLine={false} axisLine={false} tick={{ fill: '#858fa2', fontSize: 11 }} tickMargin={12} /><YAxis allowDecimals={false} tickLine={false} axisLine={false} tick={{ fill: '#9aa2b1', fontSize: 11 }} /><Tooltip cursor={{ fill: '#f7f7fb' }} contentStyle={{ border: '1px solid #eceef3', borderRadius: 12, boxShadow: '0 10px 24px #252d3a12', fontSize: 12 }} /><Bar dataKey="count" name="Employees" fill="#6e62dd" radius={[7, 7, 0, 0]} maxBarSize={42} /></BarChart></ResponsiveContainer></div> : <EmptyState icon={Users} title="No active employee records" description="Department distribution will appear when active employees are available." />}
        </Card>
        <Card className="p-5 sm:p-6"><div className="mb-3"><h2 className="text-sm font-bold text-[#2b3548]">Leave request status</h2><p className="mt-1 text-xs text-[#929bad]">Current request totals from leave records</p></div>
          {data.pendingCount + data.approvedCount ? <><div className="h-[210px]"><ResponsiveContainer width="100%" height="100%"><PieChart><Pie data={leaveStatuses} dataKey="value" nameKey="name" innerRadius={59} outerRadius={82} paddingAngle={4} stroke="none">{leaveStatuses.map((entry, index) => <Cell key={entry.name} fill={chartColors[index]} />)}</Pie><Tooltip contentStyle={{ border: '1px solid #eceef3', borderRadius: 12, fontSize: 12 }} /></PieChart></ResponsiveContainer></div><div className="mt-1 grid grid-cols-2 gap-3">{leaveStatuses.map((item, index) => <div key={item.name} className="flex items-center gap-2 rounded-xl bg-[#fafbfc] px-3 py-2.5"><span className="h-2 w-2 rounded-full" style={{ backgroundColor: chartColors[index] }} /><span className="text-xs text-[#7d8799]">{item.name}</span><strong className="ml-auto text-xs text-[#313b4e]">{item.value}</strong></div>)}</div></> : <EmptyState icon={CalendarCheck2} title="No leave requests yet" description="Request status totals will appear when employees submit leave." />}
        </Card>
      </div>
      <Card className="mt-5 overflow-hidden"><div className="flex items-center justify-between border-b border-[#eff0f4] px-5 py-4 sm:px-6"><div><h2 className="text-sm font-bold text-[#2b3548]">Recent leave requests</h2><p className="mt-1 text-xs text-[#929bad]">Latest submissions across your team</p></div><Link to="/leaves" className="inline-flex items-center gap-1 text-xs font-semibold text-[#6557d9] hover:text-[#5143c6]">View all <ArrowRight className="h-3.5 w-3.5" /></Link></div>
        {data.recentLeaves.length ? <div className="overflow-x-auto app-scrollbar"><table className="w-full min-w-[650px] text-left"><thead><tr className="bg-[#fafbfc] text-[10px] font-bold uppercase tracking-[.1em] text-[#9aa2b1]"><th className="px-6 py-3">Employee</th><th className="px-5 py-3">Leave type</th><th className="px-5 py-3">Dates</th><th className="px-5 py-3">Days</th><th className="px-5 py-3">Status</th></tr></thead><tbody className="divide-y divide-[#f0f1f5]">{data.recentLeaves.map((leave) => <tr key={leave.id} className="text-xs hover:bg-[#fcfcfe]"><td className="px-6 py-3.5"><p className="font-semibold text-[#354055]">{leave.employee?.name || 'Employee'}</p><p className="mt-0.5 text-[11px] text-[#9aa2b1]">{leave.employee?.email || '—'}</p></td><td className="px-5 py-3.5 text-[#59647a]">{leaveTypeLabel(leave.type)}</td><td className="px-5 py-3.5 text-[#59647a]">{formatDate(leave.fromDate)} – {formatDate(leave.toDate)}</td><td className="px-5 py-3.5 text-[#59647a]">{leave.totalDays}</td><td className="px-5 py-3.5"><StatusBadge status={leave.status} /></td></tr>)}</tbody></table></div> : <EmptyState icon={CalendarClock} title="No leave requests to show" description="Recent requests will appear here as they arrive." />}
      </Card>
      <div className="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {[{ title: 'Add an employee', text: 'Create a new employee account.', to: '/employees', icon: CirclePlus }, { title: 'View employees', text: 'Search the employee directory.', to: '/employees', icon: Users }, { title: 'Review leave', text: 'See requests waiting for your decision.', to: '/leaves', icon: CalendarCheck2 }, { title: 'Ask a policy question', text: 'Find answers in uploaded policy documents.', to: '/policy', icon: WandSparkles }].map(({ title, text, to, icon: Icon }) => <Link key={title} to={to} className="group rounded-2xl border border-[#e8eaf0] bg-white p-4 transition hover:-translate-y-0.5 hover:border-[#d5d1fa] hover:shadow-[0_12px_28px_rgba(45,39,105,.06)]"><div className="mb-4 flex items-center justify-between"><span className="grid h-9 w-9 place-items-center rounded-xl bg-[#f1efff] text-[#6557d9]"><Icon className="h-4 w-4" /></span><ArrowRight className="h-4 w-4 text-[#b2b8c4] transition group-hover:translate-x-1 group-hover:text-[#6557d9]" /></div><p className="text-sm font-semibold text-[#303a4d]">{title}</p><p className="mt-1 text-xs text-[#8a94a5]">{text}</p></Link>)}
      </div>
    </>}
  </>;
}

function EmployeeDashboard({ user }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const [leavesData, pendingData] = await Promise.all([
        api.get('/leaves/mine', { params: { page: 1, limit: 6 } }).then(({ data: response }) => response),
        getAllMyLeaves({ status: 'pending' }),
      ]);
      const pendingDaysByType = pendingData.leaves.reduce((totals, leave) => ({ ...totals, [leave.type]: (totals[leave.type] || 0) + leave.totalDays }), {});
      setData({ ...leavesData, pendingCount: pendingData.pagination?.total || 0, pendingDaysByType });
    } catch (requestError) { setError(getErrorMessage(requestError)); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);
  const pendingCount = data?.pendingCount || 0;
  const balances = data?.balances || [];

  return <>
    <PageHeader eyebrow="Your workspace" title={`Welcome, ${user.name.split(' ')[0]}`} description="Your leave, profile, and policy resources in one place." actions={<Link to="/leaves"><Button><CirclePlus className="h-4 w-4" />Apply for leave</Button></Link>} />
    {error && <div className="mb-5"><InlineError message={error} onRetry={load} /></div>}
    {loading && !data ? <LoadingInline label="Loading your dashboard" /> : data && <>
      <Card className="mb-5 overflow-hidden"><div className="grid gap-5 p-5 sm:grid-cols-[1fr_auto] sm:items-center sm:p-6"><div><div className="mb-2 inline-flex items-center gap-2 rounded-full bg-[#eff8f3] px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[.1em] text-[#34815d]"><span className="h-1.5 w-1.5 rounded-full bg-[#45aa76]" />Employee workspace</div><h2 className="text-lg font-bold tracking-tight text-[#263146]">A good day starts with clarity.</h2><p className="mt-1 max-w-xl text-sm leading-6 text-[#818b9d]">Review your available time off, follow requests, and get answers from your company policy documents.</p></div><div className="flex gap-2"><Link to="/leaves"><Button variant="secondary">Leave history <ArrowRight className="h-4 w-4" /></Button></Link><Link to="/policy"><Button variant="secondary"><WandSparkles className="h-4 w-4" />Ask policy</Button></Link></div></div></Card>
      <div className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">{balances.map((balance, index) => { const reserved = data.pendingDaysByType?.[balance.type] || 0; return <MetricCard key={balance.type} label={`${leaveTypeLabel(balance.type)} balance`} value={`${balance.available - reserved} days`} note={`${balance.used} used · ${reserved} pending of ${balance.total}`} icon={CalendarDays} tint={['violet', 'green', 'amber'][index % 3]} />; })}<MetricCard label="Pending requests" value={pendingCount} note="Awaiting a decision" icon={CalendarClock} tint="blue" /></div>
      <Card className="overflow-hidden"><div className="flex items-center justify-between border-b border-[#eff0f4] px-5 py-4 sm:px-6"><div><h2 className="text-sm font-bold text-[#2b3548]">Recent leave history</h2><p className="mt-1 text-xs text-[#929bad]">Your latest requests and decisions</p></div><Link to="/leaves" className="inline-flex items-center gap-1 text-xs font-semibold text-[#6557d9]">View history <ArrowRight className="h-3.5 w-3.5" /></Link></div>
        {data.leaves?.length ? <div className="overflow-x-auto app-scrollbar"><table className="w-full min-w-[620px] text-left"><thead><tr className="bg-[#fafbfc] text-[10px] font-bold uppercase tracking-[.1em] text-[#9aa2b1]"><th className="px-6 py-3">Leave</th><th className="px-5 py-3">Dates</th><th className="px-5 py-3">Days</th><th className="px-5 py-3">Status</th></tr></thead><tbody className="divide-y divide-[#f0f1f5]">{data.leaves.map((leave) => <tr key={leave.id} className="text-xs"><td className="px-6 py-3.5 font-semibold text-[#354055]">{leaveTypeLabel(leave.type)}</td><td className="px-5 py-3.5 text-[#59647a]">{formatDate(leave.fromDate)} – {formatDate(leave.toDate)}</td><td className="px-5 py-3.5 text-[#59647a]">{leave.totalDays}</td><td className="px-5 py-3.5"><StatusBadge status={leave.status} /></td></tr>)}</tbody></table></div> : <EmptyState icon={CalendarCheck2} title="No leave requests yet" description="When you apply for leave, you can track it here." action={<Link to="/leaves"><Button size="sm">Apply for leave</Button></Link>} />}
      </Card>
    </>}
  </>;
}

export default function DashboardPage() {
  const { user } = useAuth();
  return user?.role === 'hr' ? <HRDashboard user={user} /> : <EmployeeDashboard user={user} />;
}
