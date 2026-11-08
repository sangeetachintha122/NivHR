import { useCallback, useEffect, useMemo, useState } from 'react';
import { Activity, ArrowLeft, ArrowRight, CalendarDays, Check, Clock3, LogIn, LogOut, Users } from 'lucide-react';
import { api, getErrorMessage } from '../../api/client.js';
import { useAuth } from '../../context/AuthContext.jsx';
import { Button, Card, EmptyState, InlineError, LoadingInline, PageHeader, StatusBadge } from '../../components/common/Ui.jsx';
import { formatDate } from '../../utils/format.js';

const PAGE_SIZE = 10;
const INDIA_TIME_ZONE = 'Asia/Kolkata';

function todayInIndia() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: INDIA_TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function formatTime(value) {
  if (!value) return '—';
  return new Intl.DateTimeFormat('en-IN', {
    timeZone: INDIA_TIME_ZONE, hour: 'numeric', minute: '2-digit', hour12: true,
  }).format(new Date(value));
}

function EmployeeAttendancePage() {
  const [today, setToday] = useState(null);
  const [history, setHistory] = useState([]);
  const [pagination, setPagination] = useState({ page: 1, totalPages: 1, total: 0 });
  const [month, setMonth] = useState('');
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const historyParams = useMemo(() => ({ page, limit: PAGE_SIZE, ...(month ? { month } : {}) }), [page, month]);
  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [todayResponse, historyResponse] = await Promise.all([
        api.get('/attendance/today'),
        api.get('/attendance/mine', { params: historyParams }),
      ]);
      setToday(todayResponse.data.attendance);
      setHistory(historyResponse.data.attendance);
      setPagination(historyResponse.data.pagination);
    } catch (requestError) {
      setError(getErrorMessage(requestError));
    } finally {
      setLoading(false);
    }
  }, [historyParams]);

  useEffect(() => { load(); }, [load]);

  const submitAttendance = async (action) => {
    setWorking(true);
    setError('');
    setNotice('');
    try {
      await api.post(`/attendance/${action}`);
      setNotice(action === 'check-in' ? 'You are checked in.' : 'You are checked out.');
      await load();
    } catch (requestError) {
      setError(getErrorMessage(requestError));
    } finally {
      setWorking(false);
    }
  };

  const checkedIn = Boolean(today);
  const checkedOut = Boolean(today?.checkOut);

  return <>
    <PageHeader eyebrow="Daily attendance" title="Attendance" description="Record your workday and review your attendance history." />
    {notice && <div role="status" className="mb-4 rounded-xl border border-[#d6eddf] bg-[#f1faf4] px-4 py-3 text-sm text-[#27714b]">{notice}</div>}
    {error && <div className="mb-4"><InlineError message={error} onRetry={load} /></div>}
    <div className="grid gap-5 xl:grid-cols-[minmax(280px,.7fr)_minmax(0,1.3fr)]">
      <Card className="h-fit p-5 sm:p-6">
        <div className="flex items-start justify-between gap-4">
          <div><p className="text-xs font-semibold uppercase tracking-[.12em] text-[#8c95a6]">Today · India</p><p className="mt-2 text-lg font-bold text-[#293449]">{formatDate(todayInIndia())}</p></div>
          <span className="grid h-10 w-10 place-items-center rounded-xl bg-[#f0efff] text-[#6557d9]"><CalendarDays className="h-5 w-5" /></span>
        </div>
        {loading ? <LoadingInline label="Loading today's attendance" /> : <>
          <div className="mt-6 rounded-xl border border-[#ececf3] bg-[#fafaff] p-4">
            <div className="flex items-center gap-2"><Activity className="h-4 w-4 text-[#6557d9]" /><span className="text-xs font-semibold text-[#515c72]">Current status</span></div>
            <p className="mt-2 text-lg font-bold text-[#293449]">{checkedOut ? 'Workday complete' : checkedIn ? 'Checked in' : 'Not checked in'}</p>
            {checkedIn && <div className="mt-3 grid grid-cols-2 gap-3 border-t border-[#ececf3] pt-3">
              <div><p className="text-[11px] text-[#8b94a5]">Check-in</p><p className="mt-1 text-sm font-semibold text-[#4e5a70]">{formatTime(today.checkIn)}</p></div>
              <div><p className="text-[11px] text-[#8b94a5]">Check-out</p><p className="mt-1 text-sm font-semibold text-[#4e5a70]">{formatTime(today.checkOut)}</p></div>
            </div>}
            {checkedIn && <div className="mt-3"><StatusBadge status={today.isLate ? 'late' : 'active'} /></div>}
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            <Button onClick={() => submitAttendance('check-in')} disabled={working || loading || checkedIn}>
              <LogIn className="h-4 w-4" />{working ? 'Saving…' : 'Check In'}
            </Button>
            <Button variant="secondary" onClick={() => submitAttendance('check-out')} disabled={working || loading || !checkedIn || checkedOut}>
              <LogOut className="h-4 w-4" />Check Out
            </Button>
          </div>
          <p className="mt-3 text-[11px] leading-5 text-[#929bad]">Check-in and check-out times are recorded using the server clock in India Standard Time.</p>
        </>}
      </Card>

      <Card className="overflow-hidden">
        <div className="flex flex-col gap-3 border-b border-[#eff0f4] p-4 sm:flex-row sm:items-center sm:justify-between sm:px-5">
          <div><h2 className="text-sm font-bold text-[#303a4d]">Attendance history</h2><p className="mt-1 text-xs text-[#8b94a5]">{pagination.total} recorded workdays</p></div>
          <label className="flex items-center gap-2 text-xs font-medium text-[#69748a]">Month<input aria-label="Filter attendance by month" type="month" value={month} onChange={(event) => { setPage(1); setMonth(event.target.value); }} className="rounded-lg border border-[#e3e6ed] bg-white px-2.5 py-2 text-xs text-[#465167] outline-none focus:border-[#9188ee]" /></label>
        </div>
        {loading ? <LoadingInline label="Loading attendance history" /> : history.length ? <>
          <div className="overflow-x-auto app-scrollbar"><table className="w-full min-w-[590px] text-left"><thead><tr className="bg-[#fafbfc] text-[10px] font-bold uppercase tracking-[.1em] text-[#9aa2b1]"><th className="px-5 py-3">Date</th><th className="px-5 py-3">Check-in</th><th className="px-5 py-3">Check-out</th><th className="px-5 py-3">Arrival</th></tr></thead><tbody className="divide-y divide-[#f0f1f5]">{history.map((record) => <tr key={record.id} className="text-xs"><td className="px-5 py-3.5 font-semibold text-[#475268]">{formatDate(record.date)}</td><td className="px-5 py-3.5 text-[#59647a]">{formatTime(record.checkIn)}</td><td className="px-5 py-3.5 text-[#59647a]">{formatTime(record.checkOut)}</td><td className="px-5 py-3.5"><span className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${record.isLate ? 'bg-[#fff7e9] text-[#a5680b]' : 'bg-[#eaf8f0] text-[#1f8651]'}`}>{record.isLate ? 'Late' : 'On time'}</span></td></tr>)}</tbody></table></div>
          <div className="flex items-center justify-between border-t border-[#eff0f4] px-5 py-3.5"><p className="text-xs text-[#8b94a5]">Page {pagination.page} of {Math.max(pagination.totalPages, 1)}</p><div className="flex gap-2"><Button variant="secondary" size="sm" disabled={page <= 1 || loading} onClick={() => setPage((current) => current - 1)}><ArrowLeft className="h-3.5 w-3.5" />Previous</Button><Button variant="secondary" size="sm" disabled={page >= pagination.totalPages || loading} onClick={() => setPage((current) => current + 1)}>Next<ArrowRight className="h-3.5 w-3.5" /></Button></div></div>
        </> : <EmptyState icon={Clock3} title="No attendance records" description={month ? 'There are no records for this month.' : 'Your check-in and check-out history will appear here.'} />}
      </Card>
    </div>
  </>;
}

function HrAttendancePage() {
  const [date, setDate] = useState(todayInIndia);
  const [page, setPage] = useState(1);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const params = useMemo(() => ({ date, page, limit: PAGE_SIZE }), [date, page]);
  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const response = await api.get('/attendance', { params });
      setData(response.data);
    } catch (requestError) { setError(getErrorMessage(requestError)); }
    finally { setLoading(false); }
  }, [params]);
  useEffect(() => { load(); }, [load]);

  const summaryItems = [
    ['Active employees', data?.summary?.totalActiveEmployees ?? '—', Users],
    ['Checked in', data?.summary?.checkedIn ?? '—', LogIn],
    ['Checked out', data?.summary?.checkedOut ?? '—', LogOut],
    ['No record', data?.summary?.noRecord ?? '—', Clock3],
  ];

  return <>
    <PageHeader eyebrow="Team attendance" title="Attendance" description="Review daily attendance records and employees without a record." actions={<label className="flex items-center gap-2 rounded-xl border border-[#e3e6ed] bg-white px-3 py-2 text-xs font-semibold text-[#69748a]"><CalendarDays className="h-4 w-4" /><input aria-label="Attendance date" type="date" value={date} onChange={(event) => { setPage(1); setDate(event.target.value); }} className="bg-transparent text-[#465167] outline-none" /></label>} />
    {error && <div className="mb-4"><InlineError message={error} onRetry={load} /></div>}
    <div className="mb-5 grid grid-cols-2 gap-3 xl:grid-cols-4">{summaryItems.map(([label, value, Icon]) => <Card key={label} className="p-4"><div className="flex items-center justify-between"><p className="text-xs font-medium text-[#7e889b]">{label}</p><Icon className="h-4 w-4 text-[#7769dd]" /></div><p className="mt-3 text-2xl font-bold tracking-tight text-[#283247]">{value}</p></Card>)}</div>
    <Card className="overflow-hidden">
      <div className="flex items-center justify-between border-b border-[#eff0f4] px-5 py-4"><div><h2 className="text-sm font-bold text-[#303a4d]">Daily records</h2><p className="mt-1 text-xs text-[#8b94a5]">{data?.date ? formatDate(data.date) : 'Selected date'}</p></div></div>
      {loading ? <LoadingInline label="Loading team attendance" /> : data?.attendance?.length ? <>
        <div className="overflow-x-auto app-scrollbar"><table className="w-full min-w-[860px] text-left"><thead><tr className="bg-[#fafbfc] text-[10px] font-bold uppercase tracking-[.1em] text-[#9aa2b1]"><th className="px-5 py-3">Employee</th><th className="px-5 py-3">Department</th><th className="px-5 py-3">Email</th><th className="px-5 py-3">Check-in</th><th className="px-5 py-3">Check-out</th><th className="px-5 py-3">Arrival</th><th className="px-5 py-3">Status</th></tr></thead><tbody className="divide-y divide-[#f0f1f5]">{data.attendance.map((record) => <tr key={record.id} className="text-xs"><td className="px-5 py-3.5 font-semibold text-[#475268]">{record.employee.name}</td><td className="px-5 py-3.5 text-[#59647a]">{record.employee.department || '—'}</td><td className="px-5 py-3.5 text-[#59647a]">{record.employee.email}</td><td className="px-5 py-3.5 text-[#59647a]">{formatTime(record.checkIn)}</td><td className="px-5 py-3.5 text-[#59647a]">{formatTime(record.checkOut)}</td><td className="px-5 py-3.5"><span className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${record.isLate ? 'bg-[#fff7e9] text-[#a5680b]' : 'bg-[#eaf8f0] text-[#1f8651]'}`}>{record.isLate ? 'Late' : 'On time'}</span></td><td className="px-5 py-3.5"><StatusBadge status={record.checkOut ? 'checked out' : 'checked in'} /></td></tr>)}</tbody></table></div>
        <div className="flex items-center justify-between border-t border-[#eff0f4] px-5 py-3.5"><p className="text-xs text-[#8b94a5]">Page {data.pagination.page} of {Math.max(data.pagination.totalPages, 1)}</p><div className="flex gap-2"><Button variant="secondary" size="sm" disabled={page <= 1 || loading} onClick={() => setPage((current) => current - 1)}><ArrowLeft className="h-3.5 w-3.5" />Previous</Button><Button variant="secondary" size="sm" disabled={page >= data.pagination.totalPages || loading} onClick={() => setPage((current) => current + 1)}>Next<ArrowRight className="h-3.5 w-3.5" /></Button></div></div>
      </> : <EmptyState icon={Activity} title="No attendance records" description="No active employees have attendance records for this date." />}
    </Card>
    <Card className="mt-5 overflow-hidden">
      <div className="border-b border-[#eff0f4] px-5 py-4"><h2 className="text-sm font-bold text-[#303a4d]">No attendance record</h2><p className="mt-1 text-xs text-[#8b94a5]">Active employees without a record on the selected date.</p></div>
      {loading ? <LoadingInline label="Loading employees without attendance" /> : data?.employeesWithoutAttendance?.length ? <div className="divide-y divide-[#f0f1f5]">{data.employeesWithoutAttendance.map((employee) => <div key={employee.id} className="flex flex-col gap-1 px-5 py-3.5 text-xs sm:flex-row sm:items-center sm:justify-between"><span className="font-semibold text-[#475268]">{employee.name}<span className="ml-2 font-normal text-[#8b94a5]">{employee.department || 'Unassigned'}</span></span><span className="text-[#7e889b]">{employee.email}</span></div>)}</div> : <EmptyState icon={Check} title="Everyone has a record" description="All active employees have attendance recorded for this date." />}
    </Card>
  </>;
}

export default function AttendancePage() {
  const { user } = useAuth();
  return user?.role === 'hr' ? <HrAttendancePage /> : <EmployeeAttendancePage />;
}
