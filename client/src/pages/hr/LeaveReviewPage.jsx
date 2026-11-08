import { useCallback, useEffect, useState } from 'react';
import { ArrowRight, Brain, CalendarDays, CircleHelp, Clock3, ShieldCheck } from 'lucide-react';
import { api, getErrorMessage } from '../../api/client.js';
import { getAllLeaves } from '../../api/resources.js';
import { formatDate, leaveTypeLabel } from '../../utils/format.js';
import { Button, Card, EmptyState, InlineError, LoadingInline, PageHeader } from '../../components/common/Ui.jsx';

const recommendationLabels = {
  appears_compliant: 'Appears compliant',
  needs_attention: 'Needs attention',
  insufficient_information: 'Insufficient information',
};
const recommendationStyles = {
  appears_compliant: 'border-[#cdebd8] bg-[#edf8f1] text-[#23734a]',
  needs_attention: 'border-[#f1d6b8] bg-[#fff6e9] text-[#9a5d12]',
  insufficient_information: 'border-[#dfe3eb] bg-[#f4f5f8] text-[#667085]',
};
const checkLabels = { compliant: 'Compliant', concern: 'Concern', unknown: 'Unknown', not_applicable: 'Not applicable' };
const checkStyles = {
  compliant: 'bg-[#eaf8f0] text-[#1f8651]',
  concern: 'bg-[#fff2e5] text-[#a35d10]',
  unknown: 'bg-[#f0f1f5] text-[#69748a]',
  not_applicable: 'bg-[#f0f1f5] text-[#69748a]',
};

export default function LeaveReviewPage() {
  const [requests, setRequests] = useState([]);
  const [loading, setLoading] = useState(true);
  const [reviewingId, setReviewingId] = useState('');
  const [selectedId, setSelectedId] = useState('');
  const [analysis, setAnalysis] = useState(null);
  const [error, setError] = useState('');
  const load = useCallback(async () => {
    setLoading(true); setError('');
    try { setRequests(await getAllLeaves({ status: 'pending' })); }
    catch (requestError) { setError(getErrorMessage(requestError)); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const review = async (leave) => {
    if (reviewingId) return;
    setSelectedId(leave.id); setReviewingId(leave.id); setAnalysis(null); setError('');
    try {
      const { data } = await api.post(`/leaves/${leave.id}/ai-review`);
      setAnalysis({ leave, ...data.analysis });
    } catch (requestError) { setError(getErrorMessage(requestError)); }
    finally { setReviewingId(''); }
  };

  return <>
    <PageHeader eyebrow="HR decision support" title="AI leave review" description="Compare a pending request with verified facts and uploaded policy. AI advice does not replace HR judgment." />
    {error && <div className="mb-4"><InlineError message={error} onRetry={load} /></div>}
    <div className="grid min-w-0 items-start gap-4 xl:grid-cols-[minmax(280px,.72fr)_minmax(0,1.28fr)]">
      <Card className="min-w-0 overflow-hidden">
        <div className="flex items-center justify-between border-b border-[#eff0f4] px-4 py-3.5"><div><h2 className="text-sm font-bold text-[#2b3548]">Pending requests</h2><p className="mt-0.5 text-[11px] text-[#929bad]">Select a request to review</p></div><span className="rounded-full bg-[#f6f6fa] px-2.5 py-1 text-[10px] font-semibold text-[#778197]">{requests.length}</span></div>
        {loading ? <LoadingInline label="Loading pending requests" /> : requests.length ? <div className="max-h-[65vh] divide-y divide-[#f0f1f5] overflow-y-auto">{requests.map((leave) => <button key={leave.id} type="button" onClick={() => review(leave)} disabled={Boolean(reviewingId)} className={`flex w-full items-center gap-3 px-4 py-3 text-left transition hover:bg-[#fafaff] disabled:cursor-wait ${selectedId === leave.id ? 'bg-[#f7f6ff]' : 'bg-white'}`}>
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-[#f4f3ff] text-[#6b5ddd]"><CalendarDays className="h-4 w-4" /></span>
          <span className="min-w-0 flex-1"><span className="block truncate text-xs font-semibold text-[#354056]">{leave.employee?.name || 'Employee'} · {leaveTypeLabel(leave.type)}</span><span className="mt-1 block truncate text-[10px] text-[#8791a3]">{formatDate(leave.fromDate)} – {formatDate(leave.toDate)} · {leave.totalDays} working {leave.totalDays === 1 ? 'day' : 'days'}</span></span>
          {reviewingId === leave.id ? <span className="h-4 w-4 shrink-0 animate-spin rounded-full border-2 border-[#d9d5fa] border-t-[#6557d9]" aria-label="Reviewing" /> : <ArrowRight className="h-4 w-4 shrink-0 text-[#a0a7b5]" />}
        </button>)}</div> : <EmptyState icon={CalendarDays} title="No pending requests" description="New employee submissions will appear here." />}
      </Card>

      <Card className="min-w-0 overflow-hidden">
        {!analysis ? <div className="flex min-h-[230px] flex-col items-center justify-center px-5 py-8 text-center"><span className="mb-3 grid h-10 w-10 place-items-center rounded-xl bg-[#f0efff] text-[#6557d9]"><Brain className="h-5 w-5" /></span><h2 className="text-sm font-bold text-[#344056]">Review analysis</h2><p className="mt-1.5 max-w-sm text-xs leading-5 text-[#8791a3]">Select a pending request to see its recommendation, key facts, and policy evidence.</p></div> : <ReviewCard analysis={analysis} />}
      </Card>
    </div>
  </>;
}

function ReviewCard({ analysis }) {
  const facts = analysis.deterministicFacts || {};
  const concerns = analysis.policyChecks.filter((check) => check.status === 'concern');
  const unknowns = analysis.policyChecks.filter((check) => check.status === 'unknown');
  const primaryConcern = concerns[0];
  const hrFocus = primaryConcern
    ? `${primaryConcern.rule}: ${primaryConcern.explanation}`
    : analysis.missingInformation?.[0]
      ? `Confirm before deciding: ${analysis.missingInformation[0]}`
      : analysis.summary;

  return <div>
    <div className="flex flex-wrap items-start justify-between gap-3 border-b border-[#eff0f4] px-4 py-4 sm:px-5">
      <div className="min-w-0"><p className="text-[10px] font-bold uppercase tracking-[.12em] text-[#8a94a6]">{analysis.leave.employee?.name || 'Employee'}</p><h2 className="mt-1 text-base font-bold text-[#2d374b]">{leaveTypeLabel(analysis.leave.type)} request</h2><p className="mt-1 text-xs text-[#717c91]">{formatDate(analysis.leave.fromDate)} – {formatDate(analysis.leave.toDate)} <span className="mx-1 text-[#c0c5cf]">·</span>{facts.totalWorkingDaysRequested ?? analysis.leave.totalDays} working {((facts.totalWorkingDaysRequested ?? analysis.leave.totalDays) === 1) ? 'day' : 'days'}</p></div>
      <span className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-[11px] font-bold ${recommendationStyles[analysis.recommendation] || recommendationStyles.insufficient_information}`}><ShieldCheck className="h-3.5 w-3.5" />{recommendationLabels[analysis.recommendation] || recommendationLabels.insufficient_information}</span>
    </div>

    <div className="grid grid-cols-3 divide-x divide-[#edf0f4] border-b border-[#eff0f4]">
      <Fact label="Working days" value={facts.totalWorkingDaysRequested ?? analysis.leave.totalDays} />
      <Fact label="Notice days" value={facts.workingDaysAheadOfStart ?? '—'} />
      <Fact label="Balance after pending" value={facts.availableBalanceAfterAllPendingRequests ?? '—'} />
    </div>

    <div className="p-4 sm:p-5">
      <p className="mb-2 text-[10px] font-bold uppercase tracking-[.12em] text-[#8a94a6]">Policy checks</p>
      <div className="divide-y divide-[#f0f1f5] rounded-xl border border-[#eceef3] px-3">
        {analysis.policyChecks.map((check, index) => <div key={`${check.rule}-${index}`} className="flex flex-wrap items-center gap-2 py-2.5">
          <span className="min-w-0 flex-1 text-xs font-medium text-[#465168]">{check.rule}</span>
          <span className={`shrink-0 rounded-full px-2 py-1 text-[10px] font-bold ${checkStyles[check.status] || checkStyles.unknown}`}>{checkLabels[check.status] || 'Unknown'}</span>
          {check.citations?.length > 0 && <span className="basis-full pl-0.5 text-[10px] text-[#6557d9]">{check.citations.map((citation) => `${citation.docTitle} · section ${citation.chunkIndex + 1}`).join('; ')}</span>}
        </div>)}
      </div>

      <div className={`mt-3 flex items-start gap-2 rounded-xl px-3.5 py-3 ${concerns.length ? 'bg-[#fff7ec] text-[#805014]' : unknowns.length ? 'bg-[#f6f7fa] text-[#59647a]' : 'bg-[#f1f8f3] text-[#386749]'}`}>
        {concerns.length || unknowns.length ? <CircleHelp className="mt-0.5 h-4 w-4 shrink-0" /> : <Clock3 className="mt-0.5 h-4 w-4 shrink-0" />}
        <p className="text-xs leading-5"><strong className="mr-1">HR focus</strong><span className="line-clamp-2">{hrFocus}</span></p>
      </div>

      <details className="group mt-3 rounded-xl border border-[#e9ebf1]">
        <summary className="cursor-pointer list-none px-3.5 py-3 text-xs font-semibold text-[#6557d9] marker:hidden">View AI analysis</summary>
        <div className="space-y-4 border-t border-[#eff0f4] px-3.5 py-4">
          <section><h3 className="text-[11px] font-bold uppercase tracking-wider text-[#8a94a6]">Summary</h3><p className="mt-1.5 text-xs leading-5 text-[#5d687d]">{analysis.summary}</p></section>
          <section><h3 className="text-[11px] font-bold uppercase tracking-wider text-[#8a94a6]">Policy explanations</h3><div className="mt-2 space-y-2">{analysis.policyChecks.map((check, index) => <div key={`detail-${check.rule}-${index}`} className="rounded-lg bg-[#f8f9fc] p-3"><p className="text-xs font-semibold text-[#465168]">{check.rule}</p><p className="mt-1 text-xs leading-5 text-[#707b90]">{check.explanation}</p></div>)}</div></section>
          <FactList title="Additional verified facts" facts={facts} />
          <TextList title="Considerations" items={analysis.considerations} />
          <TextList title="Missing information" items={analysis.missingInformation} />
          <TextList title="Suggested questions for HR" items={analysis.suggestedQuestions} />
          <p className="rounded-lg bg-[#f8f7ff] p-3 text-[11px] font-semibold text-[#6156b9]">{analysis.disclaimer}</p>
        </div>
      </details>
    </div>
  </div>;
}

function Fact({ label, value }) {
  return <div className="min-w-0 px-2 py-3 text-center sm:px-4"><p className="truncate text-[10px] font-medium text-[#8b94a5]">{label}</p><p className="mt-1 truncate text-sm font-bold text-[#364157]">{value}</p></div>;
}

function FactList({ title, facts }) {
  const entries = [
    ['Department', facts.employeeDepartment], ['Tenure months', facts.employeeTenureMonths],
    ['Total balance', facts.leaveBalanceTotal], ['Balance used', facts.leaveBalanceUsed],
    ['Available before request', facts.availableBalanceBeforeThisRequest], ['Other pending requests', facts.otherPendingRequestCount],
    ['Other pending days', facts.otherPendingDays], ['Consecutive working days', facts.consecutiveWorkingDays],
    ['Exceeds available balance', facts.requestExceedsAvailableBalance === undefined ? undefined : facts.requestExceedsAvailableBalance ? 'Yes' : 'No'],
    ['Certificate review threshold', facts.sickLeaveCertificateReviewThresholdCrossed === undefined ? undefined : facts.sickLeaveCertificateReviewThresholdCrossed ? 'Crossed' : 'Not crossed'],
  ].filter(([, value]) => value !== undefined && value !== null && value !== '');
  if (!entries.length) return null;
  return <section><h3 className="text-[11px] font-bold uppercase tracking-wider text-[#8a94a6]">{title}</h3><div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3">{entries.map(([label, value]) => <div key={label} className="rounded-lg bg-[#f8f9fc] p-2.5"><p className="text-[10px] text-[#8b94a5]">{label}</p><p className="mt-1 text-xs font-semibold text-[#465168]">{value}</p></div>)}</div></section>;
}

function TextList({ title, items = [] }) {
  if (!items.length) return null;
  return <section><h3 className="text-[11px] font-bold uppercase tracking-wider text-[#8a94a6]">{title}</h3><ul className="mt-2 list-disc space-y-1 pl-5 text-xs leading-5 text-[#707b90]">{items.map((item, index) => <li key={`${item}-${index}`}>{item}</li>)}</ul></section>;
}
