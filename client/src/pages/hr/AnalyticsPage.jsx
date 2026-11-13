import { useEffect, useState } from 'react';
import { Activity, BarChart3, ChevronDown, LoaderCircle, PieChart as PieChartIcon, Send, Sparkles } from 'lucide-react';
import {
  Bar, BarChart, CartesianGrid, Cell, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';
import { askAnalytics, getAnalyticsConversation } from '../../api/resources.js';
import { getErrorMessage } from '../../api/client.js';
import { Button, Card, EmptyState, InlineError, PageHeader } from '../../components/common/Ui.jsx';

const exampleQuestionGroups = [
  { label: 'Employees', questions: ['How many active employees are in each department?', 'Who joined last month?'] },
  { label: 'Attendance', questions: ['Who was late this month?', 'Who checked in but has no checkout this week?'] },
  { label: 'Leave', questions: ['How many leave requests are pending?', 'Which employees used the most approved leave this year?'] },
  { label: 'Departments', questions: ['Compare this month’s attendance and approved leave by department.', 'Show department leave capacity for today.'] },
  { label: 'Activity', questions: ['How many failed login attempts occurred this month?', 'Who created or updated employee records last week?'] },
];
const CONVERSATION_STORAGE_KEY = 'nivhr_analytics_conversation';
const chartColors = ['#675ad8', '#26a269', '#e4a33b', '#d9677c', '#4e79bf', '#30a6a0'];

function AnalyticsChart({ chart }) {
  if (chart.type === 'none') return null;
  if (chart.type === 'pie') {
    return <div className="h-[260px] w-full" aria-label="Analytics pie chart">
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <Pie data={chart.data} dataKey="value" nameKey="label" innerRadius={58} outerRadius={94} paddingAngle={3} stroke="none">
            {chart.data.map((entry, index) => <Cell key={`${entry.label}-${index}`} fill={chartColors[index % chartColors.length]} />)}
          </Pie>
          <Tooltip contentStyle={{ border: '1px solid #eceef3', borderRadius: 12, fontSize: 12 }} />
        </PieChart>
      </ResponsiveContainer>
    </div>;
  }

  return <div className="h-[280px] w-full" aria-label="Analytics bar chart">
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={chart.data} margin={{ top: 8, right: 8, left: -18, bottom: 8 }}>
        <CartesianGrid vertical={false} stroke="#edf0f4" />
        <XAxis dataKey="label" tickLine={false} axisLine={false} tick={{ fill: '#858fa2', fontSize: 11 }} tickMargin={10} />
        <YAxis allowDecimals={false} tickLine={false} axisLine={false} tick={{ fill: '#9aa2b1', fontSize: 11 }} />
        <Tooltip cursor={{ fill: '#f7f7fb' }} contentStyle={{ border: '1px solid #eceef3', borderRadius: 12, fontSize: 12 }} />
        <Bar dataKey="value" name="Count" fill="#6e62dd" radius={[7, 7, 0, 0]} maxBarSize={48} />
      </BarChart>
    </ResponsiveContainer>
  </div>;
}

function ResultsTable({ table }) {
  return <div className="overflow-x-auto app-scrollbar">
    <table className="w-full min-w-[420px] text-left">
      <thead><tr className="bg-[#fafbfc] text-[10px] font-bold uppercase tracking-[.1em] text-[#9aa2b1]">
        {table.columns.map((column) => <th key={column} className="px-4 py-3">{column}</th>)}
      </tr></thead>
      <tbody className="divide-y divide-[#f0f1f5]">
        {table.rows.map((row, rowIndex) => <tr key={`row-${rowIndex}`} className="text-xs">
          {row.map((value, columnIndex) => <td key={`${rowIndex}-${columnIndex}`} className={`px-4 py-3.5 ${columnIndex === 0 ? 'font-semibold text-[#475268]' : 'text-[#59647a]'}`}>{value}</td>)}
        </tr>)}
        {table.rows.length === 0 && <tr><td colSpan={table.columns.length} className="px-4 py-8 text-center text-xs text-[#8992a3]">{table.emptyMessage || 'No matching records.'}</td></tr>}
      </tbody>
    </table>
  </div>;
}

function AnalyticsResult({ result }) {
  return <div className="grid gap-5 xl:grid-cols-[minmax(0,1.05fr)_minmax(360px,.95fr)]">
    <Card className="p-5 sm:p-6">
      <div className="mb-4 flex items-center gap-2"><span className="grid h-9 w-9 place-items-center rounded-xl bg-[#f1efff] text-[#6557d9]"><BarChart3 className="h-4 w-4" /></span><div><h2 className="text-sm font-bold text-[#303a4d]">{result.title}</h2><p className="mt-0.5 text-[11px] text-[#929bad]">Calculated from stored NivHR records</p></div></div>
      <p className="rounded-xl border border-[#e9e7fb] bg-[#faf9ff] p-4 text-sm font-medium leading-6 text-[#48416f]">{result.summary}</p>
      {result.chart?.type !== 'none' && result.chart && <div className="mt-4 border-t border-[#eff0f4] pt-4"><h3 className="mb-1 flex items-center gap-2 text-xs font-semibold text-[#59647a]">{result.chart.type === 'pie' ? <PieChartIcon className="h-3.5 w-3.5" /> : <BarChart3 className="h-3.5 w-3.5" />}Chart</h3><AnalyticsChart chart={result.chart} /></div>}
    </Card>
    <Card className="overflow-hidden">
      <div className="border-b border-[#eff0f4] px-5 py-4"><h2 className="text-sm font-bold text-[#303a4d]">Results</h2><p className="mt-1 text-xs text-[#929bad]">Structured data for {result.capability?.replaceAll('_', ' ') || 'analytics'}</p></div>
      <ResultsTable table={result.table} />
    </Card>
  </div>;
}

function ProviderLabel({ provider }) {
  const labels = { gemini: 'Gemini', cloudflare: 'Cloudflare' };
  const label = labels[provider];
  if (!label) return null;

  return <span className="rounded-full border border-[#e7e5fa] bg-white px-2 py-0.5 text-[10px] font-medium text-[#766bbd]">{label}</span>;
}

function ConversationMessage({ role, content, provider }) {
  const isUser = role === 'user';
  return <div className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}>
    <div className={`max-w-[92%] rounded-2xl px-3.5 py-3 sm:max-w-[82%] ${isUser ? 'rounded-br-md bg-[#f1efff] text-[#48416f]' : 'rounded-bl-md border border-[#eceef3] bg-white text-[#4d586d]'}`}>
      <div className={`mb-1.5 flex items-center gap-2 ${isUser ? 'justify-end' : 'justify-start'}`}>
        <span className="text-[10px] font-bold uppercase tracking-wide text-[#929bad]">{isUser ? 'You' : 'NivHR Analytics'}</span>
        {!isUser && <ProviderLabel provider={provider} />}
      </div>
      <p className="whitespace-pre-wrap text-xs leading-5 sm:text-sm">{content}</p>
    </div>
  </div>;
}

function PreviousQuestions({ messages }) {
  const olderQuestionCount = messages.filter(({ role }) => role === 'user').length;
  if (!olderQuestionCount) return null;

  return <details className="group mt-3 border-t border-[#eff0f4] pt-3">
    <summary className="flex cursor-pointer list-none items-center justify-between gap-3 text-xs font-semibold text-[#687389] marker:hidden">
      <span>Previous questions <span className="ml-1 font-normal text-[#9aa2b1]">({olderQuestionCount})</span></span>
      <ChevronDown className="h-4 w-4 shrink-0 text-[#929bad] transition-transform group-open:rotate-180" />
    </summary>
    <div className="mt-3 max-h-80 space-y-3 overflow-y-auto pr-1">
      {messages.map((message, index) => <ConversationMessage
        key={`${message.role}-${index}`}
        role={message.role}
        content={message.content}
      />)}
    </div>
  </details>;
}

export default function AnalyticsPage() {
  const [question, setQuestion] = useState('');
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [conversationId, setConversationId] = useState(() => sessionStorage.getItem(CONVERSATION_STORAGE_KEY));
  const [conversationHistory, setConversationHistory] = useState([]);
  const [answeredQuestion, setAnsweredQuestion] = useState('');

  useEffect(() => {
    if (!conversationId) return;
    getAnalyticsConversation(conversationId)
      .then((conversation) => setConversationHistory(conversation.conversationHistory))
      .catch(() => {
        sessionStorage.removeItem(CONVERSATION_STORAGE_KEY);
        setConversationId(null);
      });
  }, [conversationId]);

  const runQuestion = async (value = question) => {
    const trimmedQuestion = value.trim();
    if (trimmedQuestion.length < 3 || loading) return;
    setQuestion(trimmedQuestion);
    setError('');
    setLoading(true);
    try {
      const response = await askAnalytics(trimmedQuestion, conversationId);
      setResult(response);
      setAnsweredQuestion(trimmedQuestion);
      setConversationId(response.conversationId);
      sessionStorage.setItem(CONVERSATION_STORAGE_KEY, response.conversationId);
      setConversationHistory(response.conversationHistory || []);
    } catch (requestError) {
      setResult(null);
      setError(getErrorMessage(requestError));
    } finally {
      setLoading(false);
    }
  };

  const startNewConversation = () => {
    sessionStorage.removeItem(CONVERSATION_STORAGE_KEY);
    setConversationId(null);
    setConversationHistory([]);
    setQuestion('');
    setResult(null);
    setAnsweredQuestion('');
    setError('');
  };

  const latestQuestion = result
    ? answeredQuestion
    : [...conversationHistory].reverse().find(({ role }) => role === 'user')?.content;
  const hasCombinedEmployeeActivity = result?.results?.some(({ presentation }) => presentation === 'combined_employee_activity');
  const latestAnswer = result
    ? (hasCombinedEmployeeActivity ? 'Combined activity results are shown below.' : result.supported ? result.answer : result.message)
    : [...conversationHistory].reverse().find(({ role }) => role === 'assistant')?.content;
  const previousMessages = conversationHistory.slice(0, -2);

  return <>
    <PageHeader eyebrow="People insights" title="HR Analytics" description="Ask follow-up questions about workforce, leave, attendance, and recorded HR activity." />
    {error && <div className="mb-5"><InlineError message={error} onRetry={() => runQuestion()} /></div>}

    <Card className="mb-5 p-4 sm:p-6">
      <form onSubmit={(event) => { event.preventDefault(); runQuestion(); }}>
        <label htmlFor="analytics-question" className="mb-2 block text-xs font-semibold text-[#485267]">What would you like to know?</label>
        <textarea
          id="analytics-question"
          value={question}
          onChange={(event) => setQuestion(event.target.value.slice(0, 300))}
          placeholder="Ask a question, then follow up with comparisons or a narrower date range…"
          maxLength={300}
          rows={3}
          className="w-full resize-y rounded-xl border border-[#dfe3eb] bg-white px-3.5 py-3 text-sm text-[#283247] outline-none transition placeholder:text-[#a3aabb] focus:border-[#9188ee] focus:ring-4 focus:ring-[#6557d9]/10"
        />
        <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <span className="text-[11px] text-[#929bad]">Aggregate HR data only · {question.length}/300</span>
          <Button type="submit" disabled={loading || question.trim().length < 3}>
            {loading ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            {loading ? 'Analyzing…' : 'Ask Analytics'}
          </Button>
        </div>
      </form>
      {(conversationId || conversationHistory.length > 0) && <div className="mt-4 flex justify-end border-t border-[#eff0f4] pt-3"><button type="button" onClick={startNewConversation} disabled={loading} className="text-xs font-semibold text-[#6557d9] hover:text-[#4f43bb] disabled:opacity-50">Start a new conversation</button></div>}
      {!result && !loading && <div className="mt-5 border-t border-[#eff0f4] pt-4">
        <p className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[.08em] text-[#929bad]"><Sparkles className="h-3.5 w-3.5 text-[#7668df]" />Try an example</p>
        <div className="grid gap-3 sm:grid-cols-2">{exampleQuestionGroups.map((group) => <div key={group.label}><p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-[#9aa2b1]">{group.label}</p><div className="flex flex-wrap gap-2">{group.questions.map((example) => <button key={example} type="button" onClick={() => { setQuestion(example); runQuestion(example); }} disabled={loading} className="rounded-full border border-[#e8eaf0] bg-[#fcfcfd] px-3 py-2 text-left text-xs text-[#606b80] transition hover:border-[#d5d1fa] hover:bg-[#f7f6ff] hover:text-[#5548c3] disabled:opacity-50">{example}</button>)}</div></div>)}</div>
      </div>}
    </Card>

    {loading && <Card className="mb-5 flex items-center justify-center gap-2 p-8 text-sm text-[#7c8698]" role="status"><LoaderCircle className="h-4 w-4 animate-spin text-[#6557d9]" />Interpreting the question and analyzing records…</Card>}

    {latestQuestion && latestAnswer && <Card className="mb-5 p-4 sm:p-5" aria-label="Latest analytics conversation">
      <div className="space-y-3">
        <ConversationMessage role="user" content={latestQuestion} />
        <ConversationMessage role="assistant" content={latestAnswer} provider={result?.provider} />
      </div>
      <PreviousQuestions messages={previousMessages} />
    </Card>}

    {result?.supported === false && <Card className="p-5 sm:p-6">
      <EmptyState icon={Activity} title={result.state === 'clarification' ? 'Please clarify' : result.state === 'unavailable' ? 'Data not available' : 'Analytics could not answer'} description={result.message} />
      <div className="mx-auto max-w-2xl border-t border-[#eff0f4] pt-4">
        <p className="mb-2 text-xs font-semibold text-[#59647a]">Try one of these questions</p>
        <div className="flex flex-wrap gap-2">{result.examples.map((example) => <button key={example} type="button" onClick={() => { setQuestion(example); runQuestion(example); }} disabled={loading} className="rounded-full border border-[#e8eaf0] bg-white px-3 py-2 text-left text-xs text-[#606b80] transition hover:border-[#d5d1fa] hover:bg-[#f7f6ff] hover:text-[#5548c3]">{example}</button>)}</div>
      </div>
    </Card>}

    {result?.supported === true && <>
      {!hasCombinedEmployeeActivity && <Card className="mb-5 p-5 sm:p-6"><h2 className="mb-2 text-sm font-bold text-[#303a4d]">Answer</h2><p className="text-sm leading-6 text-[#48416f]">{result.answer}</p></Card>}
      <div className="space-y-5">{(result.results?.length ? result.results : [result]).map((item, index) => <AnalyticsResult key={`${item.capability || item.intent}-${index}`} result={item} />)}</div>
    </>}
  </>;
}
