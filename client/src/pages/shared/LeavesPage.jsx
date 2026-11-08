import { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowLeft, ArrowRight, CalendarDays, Check, Clock3, Filter, Search, X, XCircle } from 'lucide-react';
import { api, getErrorMessage } from '../../api/client.js';
import { getAllLeaves, getAllMyLeaves } from '../../api/resources.js';
import { useAuth } from '../../context/AuthContext.jsx';
import { countWorkingDays, formatDate, leaveTypeLabel } from '../../utils/format.js';
import { Button, Card, EmptyState, Field, InlineError, LoadingInline, Modal, PageHeader, StatusBadge } from '../../components/common/Ui.jsx';

const PAGE_SIZE = 10;

function todayInIndia() {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
  return `${values.year}-${values.month}-${values.day}`;
}

export default function LeavesPage() {
  const { user } = useAuth();
  return user?.role === 'hr' ? <HRLeavePage /> : <EmployeeLeavePage />;
}

function EmployeeLeavePage() {
  const [payload, setPayload] = useState(null);
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const [form, setForm] = useState({ type: 'annual', fromDate: '', toDate: '', reason: '' });
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [cancelTarget, setCancelTarget] = useState(null);
  const [cancelling, setCancelling] = useState(false);
  const [cancelError, setCancelError] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const params = useMemo(() => ({ page, limit: PAGE_SIZE, ...(status ? { status } : {}) }), [page, status]);
  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const [{ data }, pendingData] = await Promise.all([
        api.get('/leaves/mine', { params }),
        getAllMyLeaves({ status: 'pending' }),
      ]);
      const pendingDaysByType = pendingData.leaves.reduce((totals, leave) => ({ ...totals, [leave.type]: (totals[leave.type] || 0) + leave.totalDays }), {});
      setPayload({ ...data, pendingDaysByType });
    }
    catch (requestError) { setError(getErrorMessage(requestError)); }
    finally { setLoading(false); }
  }, [params]);
  useEffect(() => { load(); }, [load]);

  const days = countWorkingDays(form.fromDate, form.toDate);
  const selectedBalance = payload?.balances?.find((balance) => balance.type === form.type);
  const available = selectedBalance ? selectedBalance.available - (payload?.pendingDaysByType?.[form.type] || 0) : undefined;
  const submit = async (event) => {
    event.preventDefault(); setError(''); setNotice('');
    if (days < 1) { setError('Choose a date range that includes at least one weekday.'); return; }
    setSubmitting(true);
    try {
      await api.post('/leaves', { type: form.type, fromDate: form.fromDate, toDate: form.toDate, reason: form.reason.trim() });
      setForm({ type: 'annual', fromDate: '', toDate: '', reason: '' }); setNotice('Your leave request was submitted.'); setPage(1); setStatus('');
      const [{ data }, pendingData] = await Promise.all([
        api.get('/leaves/mine', { params: { page: 1, limit: PAGE_SIZE } }),
        getAllMyLeaves({ status: 'pending' }),
      ]);
      const pendingDaysByType = pendingData.leaves.reduce((totals, leave) => ({ ...totals, [leave.type]: (totals[leave.type] || 0) + leave.totalDays }), {});
      setPayload({ ...data, pendingDaysByType });
    } catch (requestError) { setError(getErrorMessage(requestError)); }
    finally { setSubmitting(false); }
  };
  const cancelRequest = async () => {
    if (!cancelTarget || cancelling) return;
    setCancelling(true); setCancelError(''); setError(''); setNotice('');
    try {
      await api.patch(`/leaves/${cancelTarget.id}/cancel`);
      setCancelTarget(null);
      setNotice('Leave request cancelled.');
      await load();
    } catch (requestError) { setCancelError(getErrorMessage(requestError)); }
    finally { setCancelling(false); }
  };

  return <>
    <PageHeader eyebrow="Time away" title="Leave management" description="Check your available balance, submit a request, and follow its progress." />
    {notice && <div role="status" className="mb-4 rounded-xl border border-[#d6eddf] bg-[#f1faf4] px-4 py-3 text-sm text-[#27714b]">{notice}</div>}
    {error && <div className="mb-4"><InlineError message={error} /></div>}
    <div className="grid gap-5 xl:grid-cols-[.8fr_1.2fr]">
      <div className="space-y-5">
        <div className="grid gap-3 sm:grid-cols-3 xl:grid-cols-1 2xl:grid-cols-3">{(payload?.balances || []).map((balance) => { const reserved = payload.pendingDaysByType?.[balance.type] || 0; const availableBalance = balance.available - reserved; return <Card key={balance.type} className="p-4"><div className="flex items-center justify-between"><span className="text-xs font-semibold text-[#69748a]">{leaveTypeLabel(balance.type)}</span><span className="grid h-8 w-8 place-items-center rounded-xl bg-[#f1efff] text-[#6557d9]"><CalendarDays className="h-4 w-4" /></span></div><p className="mt-3 text-[24px] font-bold tracking-tight text-[#263146]">{availableBalance}<span className="ml-1 text-xs font-medium text-[#8f98a8]">available</span></p><p className="mt-1 text-[11px] text-[#969eae]">{balance.used} used · {reserved} pending · {balance.total} total</p><div className="mt-3 h-1.5 overflow-hidden rounded-full bg-[#eff0f5]"><div className="h-full rounded-full bg-[#7669df]" style={{ width: `${balance.total ? Math.min(100, ((balance.used + reserved) / balance.total) * 100) : 0}%` }} /></div></Card>; })}</div>
        <Card className="p-5 sm:p-6"><div className="mb-5"><div className="mb-2 inline-flex items-center gap-2 rounded-full bg-[#f2f0ff] px-2.5 py-1 text-[10px] font-bold uppercase tracking-[.1em] text-[#6557d9]"><CalendarDays className="h-3 w-3" />New request</div><h2 className="text-base font-bold text-[#2c364a]">Apply for leave</h2><p className="mt-1 text-xs leading-5 text-[#8b94a5]">Weekends are excluded from the working-day preview.</p></div>
          <form onSubmit={submit} className="space-y-4">
            <Field as="select" label="Leave type" value={form.type} onChange={(event) => setForm({ ...form, type: event.target.value })}><option value="annual">Annual leave</option><option value="sick">Sick leave</option><option value="casual">Casual leave</option></Field>
            <div className="grid grid-cols-2 gap-3"><Field label="Start date" type="date" required min={todayInIndia()} value={form.fromDate} onChange={(event) => setForm({ ...form, fromDate: event.target.value })} /><Field label="End date" type="date" required min={form.fromDate || todayInIndia()} value={form.toDate} onChange={(event) => setForm({ ...form, toDate: event.target.value })} /></div>
            <Field as="textarea" label="Reason" required minLength={1} maxLength={2000} value={form.reason} onChange={(event) => setForm({ ...form, reason: event.target.value })} placeholder="Share a short reason for your request" />
            <div className="flex items-center justify-between rounded-xl bg-[#f8f8fc] px-3.5 py-3"><span className="text-xs text-[#737e92]">Working days</span><strong className="text-sm text-[#343e52]">{form.fromDate && form.toDate ? days : '—'}{days ? ' days' : ''}</strong></div>
            {available !== undefined && <p className="text-xs text-[#7e889b]">Available {leaveTypeLabel(form.type).toLowerCase()} balance: <strong className="text-[#4d5870]">{available} days</strong></p>}
            <Button type="submit" disabled={submitting || loading} className="w-full">{submitting ? 'Submitting…' : 'Submit leave request'}</Button>
          </form>
        </Card>
      </div>
      <Card className="min-w-0 overflow-hidden"><div className="flex flex-col gap-3 border-b border-[#eff0f4] p-4 sm:flex-row sm:items-center sm:justify-between sm:px-5"><div><h2 className="text-sm font-bold text-[#2b3548]">My leave history</h2><p className="mt-1 text-xs text-[#929bad]">Your requests and decisions</p></div><label className="flex items-center gap-2 rounded-xl border border-[#e3e6ed] px-3 text-xs text-[#69748a]"><Filter className="h-3.5 w-3.5" /><select aria-label="Filter leave history by status" value={status} onChange={(event) => { setStatus(event.target.value); setPage(1); }} className="bg-transparent py-2.5 outline-none"><option value="">All statuses</option><option value="pending">Pending</option><option value="approved">Approved</option><option value="rejected">Rejected</option><option value="cancelled">Cancelled</option></select></label></div>
        {loading && !payload ? <LoadingInline label="Loading leave history" /> : payload?.leaves?.length ? <><div className="divide-y divide-[#f0f1f5]">{payload.leaves.map((leave) => <article key={leave.id} className="p-4 sm:p-5"><div className="flex flex-wrap items-start justify-between gap-3"><div><div className="flex items-center gap-2"><h3 className="text-sm font-semibold text-[#344056]">{leaveTypeLabel(leave.type)}</h3><StatusBadge status={leave.status} /></div><p className="mt-1.5 text-xs text-[#818b9d]">{formatDate(leave.fromDate)} – {formatDate(leave.toDate)} <span className="mx-1 text-[#c0c5cf]">·</span> {leave.totalDays} working {leave.totalDays === 1 ? 'day' : 'days'}</p></div><div className="flex flex-wrap items-center gap-2"><span className="text-[10px] text-[#a0a7b5]">Submitted {formatDate(leave.createdAt)}</span>{leave.status === 'pending' && <Button type="button" size="sm" variant="subtle" className="!px-2 !py-1.5 text-[11px] text-[#a23b4b]" onClick={() => { setCancelError(''); setCancelTarget(leave); }} disabled={cancelling}><XCircle className="h-3.5 w-3.5" />Cancel Request</Button>}</div></div><p className="mt-3 whitespace-pre-wrap text-xs leading-5 text-[#667186]">{leave.reason}</p>{leave.status === 'rejected' && leave.rejectionReason && <div className="mt-3 rounded-xl border border-[#f2dfe1] bg-[#fffafa] px-3.5 py-3 text-xs text-[#8d4b55]"><strong>Rejection reason:</strong> {leave.rejectionReason}</div>}</article>)}</div><Pagination pagination={payload.pagination} page={page} setPage={setPage} /> </> : <EmptyState icon={Clock3} title={status ? 'No requests with this status' : 'No leave history yet'} description={status ? 'Choose another status to view more requests.' : 'Requests you submit will appear here.'} />}
      </Card>
    </div>
    {cancelTarget && <Modal title="Cancel leave request" description="Are you sure you want to cancel this leave request?" onClose={() => !cancelling && setCancelTarget(null)}><div className="space-y-4">{cancelError && <InlineError message={cancelError} />}<div className="rounded-xl bg-[#f7f8fb] p-4 text-sm text-[#59647a]"><strong>{leaveTypeLabel(cancelTarget.type)}</strong><p className="mt-1 text-xs">{formatDate(cancelTarget.fromDate)} – {formatDate(cancelTarget.toDate)}</p></div><div className="flex justify-end gap-2"><Button type="button" variant="secondary" onClick={() => setCancelTarget(null)} disabled={cancelling}>Cancel</Button><Button type="button" variant="danger" onClick={cancelRequest} disabled={cancelling}><XCircle className="h-4 w-4" />{cancelling ? 'Cancelling…' : 'Confirm'}</Button></div></div></Modal>}
  </>;
}

function HRLeavePage() {
  const [leaves, setLeaves] = useState([]);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [type, setType] = useState('');
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [decision, setDecision] = useState(null);
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try { setLeaves(await getAllLeaves({ ...(status ? { status } : {}), ...(type ? { type } : {}) })); }
    catch (requestError) { setError(getErrorMessage(requestError)); }
    finally { setLoading(false); }
  }, [status, type]);
  useEffect(() => { load(); }, [load]);
  const filtered = useMemo(() => leaves.filter((leave) => {
    const query = search.trim().toLowerCase();
    return !query || `${leave.employee?.name || ''} ${leave.employee?.email || ''}`.toLowerCase().includes(query);
  }), [leaves, search]);
  const pages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const visible = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const saveDecision = async (nextDecision) => {
    setSaving(true); setError('');
    try {
      await api.patch(`/leaves/${decision.leave.id}/decision`, nextDecision);
      setDecision(null); setReason(''); setNotice(nextDecision.decision === 'approved' ? 'Leave request approved.' : 'Leave request rejected.'); await load();
    } catch (requestError) { setError(getErrorMessage(requestError)); }
    finally { setSaving(false); }
  };
  const openDecision = (leave, action) => { setReason(''); setDecision({ leave, action }); };

  return <>
    <PageHeader eyebrow="Team time away" title="Leave management" description="Review employee leave requests and record decisions." />
    {notice && <div role="status" className="mb-4 rounded-xl border border-[#d6eddf] bg-[#f1faf4] px-4 py-3 text-sm text-[#27714b]">{notice}<button className="float-right text-xs font-semibold" onClick={() => setNotice('')}>Dismiss</button></div>}
    {error && <div className="mb-4"><InlineError message={error} onRetry={load} /></div>}
    <Card className="overflow-hidden">
      <div className="flex flex-col gap-3 border-b border-[#eff0f4] p-4 sm:flex-row sm:items-center sm:p-5">
        <div className="relative min-w-0 flex-1 sm:max-w-[330px]"><Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#9ba3b2]" /><input aria-label="Search requests by employee" value={search} onChange={(event) => { setSearch(event.target.value); setPage(1); }} placeholder="Search employee name or email" className="w-full rounded-xl border border-[#e3e6ed] bg-[#fcfcfd] py-2.5 pl-9 pr-3 text-xs outline-none focus:border-[#9188ee] focus:ring-4 focus:ring-[#6557d9]/10" /></div>
        <div className="flex flex-wrap gap-2"><label className="flex items-center gap-2 rounded-xl border border-[#e3e6ed] px-3 text-xs text-[#69748a]"><Filter className="h-3.5 w-3.5" /><select aria-label="Filter leave status" value={status} onChange={(event) => { setStatus(event.target.value); setPage(1); }} className="bg-transparent py-2.5 outline-none"><option value="">All statuses</option><option value="pending">Pending</option><option value="approved">Approved</option><option value="rejected">Rejected</option><option value="cancelled">Cancelled</option></select></label><label className="rounded-xl border border-[#e3e6ed] px-3 text-xs text-[#69748a]"><select aria-label="Filter leave type" value={type} onChange={(event) => { setType(event.target.value); setPage(1); }} className="bg-transparent py-2.5 outline-none"><option value="">All leave types</option><option value="annual">Annual</option><option value="sick">Sick</option><option value="casual">Casual</option></select></label><span className="ml-auto self-center text-xs text-[#919aab]">{filtered.length} requests</span></div>
      </div>
      {loading ? <LoadingInline label="Loading leave requests" /> : visible.length ? <><div className="overflow-x-auto app-scrollbar"><table className="w-full min-w-[940px] text-left"><thead><tr className="bg-[#fafbfc] text-[10px] font-bold uppercase tracking-[.1em] text-[#9aa2b1]"><th className="px-5 py-3.5 sm:px-6">Employee</th><th className="px-5 py-3.5">Leave</th><th className="px-5 py-3.5">Dates</th><th className="px-5 py-3.5">Days</th><th className="px-5 py-3.5">Reason</th><th className="px-5 py-3.5">Status</th><th className="px-5 py-3.5 text-right">Decision</th></tr></thead><tbody className="divide-y divide-[#f0f1f5]">{visible.map((leave) => <tr key={leave.id} className="align-top text-xs hover:bg-[#fcfcfe]"><td className="px-5 py-4 sm:px-6"><p className="font-semibold text-[#384358]">{leave.employee?.name || 'Employee'}</p><p className="mt-1 text-[11px] text-[#969eae]">{leave.employee?.email || '—'}</p></td><td className="px-5 py-4 text-[#59647a]">{leaveTypeLabel(leave.type)}</td><td className="whitespace-nowrap px-5 py-4 text-[#59647a]">{formatDate(leave.fromDate)}<br /><span className="text-[#9ba3b2]">to {formatDate(leave.toDate)}</span></td><td className="px-5 py-4 font-semibold text-[#465168]">{leave.totalDays}</td><td className="max-w-[220px] px-5 py-4 leading-5 text-[#788297]">{leave.reason}</td><td className="px-5 py-4"><StatusBadge status={leave.status} /></td><td className="px-5 py-4"><div className="flex justify-end gap-1.5">{leave.status === 'pending' ? <><button onClick={() => openDecision(leave, 'approve')} className="rounded-lg bg-[#edf8f1] px-2.5 py-2 text-[10px] font-bold text-[#278051] hover:bg-[#dcf2e4]">Approve</button><button onClick={() => openDecision(leave, 'reject')} className="rounded-lg bg-[#fff1f2] px-2.5 py-2 text-[10px] font-bold text-[#b94b58] hover:bg-[#ffe2e5]">Reject</button></> : <span className="text-[10px] text-[#a0a7b5]">Reviewed</span>}</div></td></tr>)}</tbody></table></div><div className="flex items-center justify-between border-t border-[#eff0f4] px-5 py-3.5 sm:px-6"><p className="text-xs text-[#8b94a5]">Page {page} of {pages}</p><div className="flex gap-2"><Button size="sm" variant="secondary" disabled={page <= 1} onClick={() => setPage((current) => current - 1)}><ArrowLeft className="h-3.5 w-3.5" />Previous</Button><Button size="sm" variant="secondary" disabled={page >= pages} onClick={() => setPage((current) => current + 1)}>Next<ArrowRight className="h-3.5 w-3.5" /></Button></div></div></> : <EmptyState icon={CalendarDays} title="No leave requests found" description={search || status || type ? 'Try a different search or filter.' : 'New employee submissions will appear here.'} />}
    </Card>
    {decision?.action === 'approve' && <Modal title="Approve leave request" description="This decision will be saved to the employee’s leave record." onClose={() => !saving && setDecision(null)}><div className="rounded-xl bg-[#f7f8fb] p-4 text-sm text-[#59647a]"><p><strong>{decision.leave.employee?.name || 'Employee'}</strong> · {leaveTypeLabel(decision.leave.type)}</p><p className="mt-1 text-xs">{formatDate(decision.leave.fromDate)} – {formatDate(decision.leave.toDate)} · {decision.leave.totalDays} working days</p></div><div className="mt-5 flex justify-end gap-2"><Button variant="secondary" onClick={() => setDecision(null)} disabled={saving}>Cancel</Button><Button onClick={() => saveDecision({ decision: 'approved' })} disabled={saving}><Check className="h-4 w-4" />{saving ? 'Saving…' : 'Confirm approval'}</Button></div></Modal>}
    {decision?.action === 'reject' && <Modal title="Reject leave request" description="Add a reason so the employee understands the decision." onClose={() => !saving && setDecision(null)}><div className="mb-4 rounded-xl bg-[#f7f8fb] p-4 text-sm text-[#59647a]"><strong>{decision.leave.employee?.name || 'Employee'}</strong> · {leaveTypeLabel(decision.leave.type)} · {decision.leave.totalDays} working days</div><form onSubmit={(event) => { event.preventDefault(); saveDecision({ decision: 'rejected', rejectionReason: reason.trim() }); }}><Field as="textarea" label="Rejection reason" required maxLength={2000} value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Explain why this request cannot be approved" /><div className="mt-5 flex justify-end gap-2"><Button type="button" variant="secondary" onClick={() => setDecision(null)} disabled={saving}>Cancel</Button><Button type="submit" variant="danger" disabled={saving || !reason.trim()}><X className="h-4 w-4" />{saving ? 'Saving…' : 'Confirm rejection'}</Button></div></form></Modal>}
  </>;
}

function Pagination({ pagination = {}, page, setPage }) {
  const pages = Math.max(1, pagination.totalPages || 1);
  return <div className="flex items-center justify-between border-t border-[#eff0f4] px-4 py-3.5 sm:px-5"><p className="text-xs text-[#8b94a5]">Page {page} of {pages} · {pagination.total || 0} requests</p><div className="flex gap-2"><Button size="sm" variant="secondary" disabled={page <= 1} onClick={() => setPage((current) => current - 1)}><ArrowLeft className="h-3.5 w-3.5" />Previous</Button><Button size="sm" variant="secondary" disabled={page >= pages} onClick={() => setPage((current) => current + 1)}>Next<ArrowRight className="h-3.5 w-3.5" /></Button></div></div>;
}
