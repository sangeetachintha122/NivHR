import { useCallback, useEffect, useRef, useState } from 'react';
import { Bot, FileText, MessageSquareText, Paperclip, Send, Sparkles, Trash2, UploadCloud, X } from 'lucide-react';
import { api, getErrorMessage } from '../../api/client.js';
import { useAuth } from '../../context/AuthContext.jsx';
import { Button, Card, EmptyState, Field, InlineError, LoadingInline, Modal, PageHeader, UserAvatar } from '../../components/common/Ui.jsx';

const suggestions = [
  'How much annual leave do I have?',
  'How do I request sick leave?',
  'What is the notice period for annual leave?',
];

export default function PolicyPage() {
  const { user } = useAuth();
  const [documents, setDocuments] = useState([]);
  const [documentsLoading, setDocumentsLoading] = useState(true);
  const [documentsError, setDocumentsError] = useState('');
  const [messages, setMessages] = useState([]);
  const [mobilePanel, setMobilePanel] = useState('chat');
  const [question, setQuestion] = useState('');
  const [asking, setAsking] = useState(false);
  const [chatError, setChatError] = useState('');
  const [uploadOpen, setUploadOpen] = useState(false);
  const [deleteDoc, setDeleteDoc] = useState(null);
  const [notice, setNotice] = useState('');
  const bottomRef = useRef(null);

  const loadDocuments = useCallback(async () => {
    setDocumentsLoading(true); setDocumentsError('');
    try { const { data } = await api.get('/policies'); setDocuments(data.documents || []); }
    catch (error) { setDocumentsError(getErrorMessage(error)); }
    finally { setDocumentsLoading(false); }
  }, []);
  useEffect(() => { loadDocuments(); }, [loadDocuments]);
  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' }); }, [messages, asking]);

  const ask = async (value = question) => {
    const text = value.trim();
    if (!text || asking) return;
    setQuestion(''); setChatError(''); setMessages((current) => [...current, { role: 'user', text }]); setAsking(true);
    try {
      const { data } = await api.post('/policies/ask', { question: text });
      setMessages((current) => [...current, { role: 'assistant', answer: data.answer, found: data.found, sources: data.sources || [] }]);
    } catch (error) { setChatError(getErrorMessage(error)); }
    finally { setAsking(false); }
  };

  const deleteDocument = async () => {
    try { await api.delete(`/policies/${deleteDoc.id}`); setDeleteDoc(null); setNotice('Policy document deleted.'); await loadDocuments(); }
    catch (error) { setDocumentsError(getErrorMessage(error)); setDeleteDoc(null); }
  };
  const uploaded = async () => { setUploadOpen(false); setNotice('Policy document uploaded and indexed.'); await loadDocuments(); };

  return <>
    <PageHeader eyebrow="Company knowledge" title="Policy assistant" description="Ask questions grounded in the policy documents your HR team has uploaded." actions={user.role === 'hr' ? <Button onClick={() => setUploadOpen(true)}><UploadCloud className="h-4 w-4" />Upload policy</Button> : undefined} />
    {notice && <div role="status" className="mb-4 flex items-center justify-between rounded-xl border border-[#d6eddf] bg-[#f1faf4] px-4 py-3 text-sm text-[#27714b]">{notice}<button onClick={() => setNotice('')} className="text-xs font-semibold">Dismiss</button></div>}
    <div className="mb-3 flex shrink-0 gap-2 xl:hidden" role="tablist" aria-label="Policy assistant panels">
      <button type="button" role="tab" aria-selected={mobilePanel === 'chat'} onClick={() => setMobilePanel('chat')} className={`flex-1 rounded-xl px-3 py-2.5 text-xs font-semibold ${mobilePanel === 'chat' ? 'bg-[#6557d9] text-white' : 'border border-[#e3e6ed] bg-white text-[#69748a]'}`}>Chat</button>
      <button type="button" role="tab" aria-selected={mobilePanel === 'library'} onClick={() => setMobilePanel('library')} className={`flex-1 rounded-xl px-3 py-2.5 text-xs font-semibold ${mobilePanel === 'library' ? 'bg-[#6557d9] text-white' : 'border border-[#e3e6ed] bg-white text-[#69748a]'}`}>Policy library</button>
    </div>
    <div className="grid min-h-0 min-w-0 flex-1 items-stretch gap-5 xl:grid-cols-[minmax(0,1fr)_330px]">
      <Card className={`${mobilePanel === 'chat' ? 'flex' : 'hidden xl:flex'} min-h-0 min-w-0 flex-col overflow-hidden`}>
        <div className="flex items-center gap-3 border-b border-[#eff0f4] px-5 py-4"><div className="grid h-9 w-9 place-items-center rounded-xl bg-[#f0efff] text-[#6557d9]"><Bot className="h-[18px] w-[18px]" /></div><div className="min-w-0 flex-1"><h2 className="text-sm font-bold text-[#2b3548]">Ask about your policies</h2><p className="mt-0.5 text-[11px] text-[#929bad]">Answers use uploaded documents and include source references.</p></div><button onClick={() => { setMessages([]); setChatError(''); }} disabled={!messages.length || asking} className="rounded-lg px-2.5 py-2 text-[11px] font-semibold text-[#858fa2] hover:bg-[#f6f6fa] disabled:opacity-40">Clear chat</button></div>
        <div className="app-scrollbar min-h-0 min-w-0 flex-1 space-y-5 overflow-y-auto bg-[#fcfcfe] px-4 py-5 sm:px-6">
          {!messages.length ? <div className="flex min-h-[390px] flex-col items-center justify-center text-center"><div className="mb-4 grid h-14 w-14 place-items-center rounded-2xl bg-[#f0efff] text-[#6557d9]"><Sparkles className="h-6 w-6" /></div><h3 className="text-base font-bold text-[#2b3548]">What would you like to know?</h3><p className="mt-2 max-w-sm text-xs leading-5 text-[#8791a3]">Ask about leave, benefits, or another topic covered in your company policies.</p><div className="mt-6 flex max-w-xl flex-wrap justify-center gap-2">{suggestions.map((item) => <button key={item} onClick={() => ask(item)} disabled={asking} className="rounded-full border border-[#e6e5f5] bg-white px-3.5 py-2 text-[11px] font-medium text-[#6557d9] transition hover:border-[#c9c3f3] hover:bg-[#f8f7ff]">{item}</button>)}</div></div> : messages.map((message, index) => <ChatMessage key={`${message.role}-${index}`} message={message} user={user} />)}
          {asking && <div className="flex items-start gap-3"><div className="grid h-8 w-8 shrink-0 place-items-center rounded-xl bg-[#f0efff] text-[#6557d9]"><Bot className="h-4 w-4" /></div><div className="rounded-2xl rounded-tl-md border border-[#ececf2] bg-white px-4 py-3 text-xs text-[#778197]"><span className="inline-flex items-center gap-2"><span className="flex gap-1"><span className="h-1.5 w-1.5 animate-bounce rounded-full bg-[#8176df] [animation-delay:-.2s]" /><span className="h-1.5 w-1.5 animate-bounce rounded-full bg-[#8176df] [animation-delay:-.1s]" /><span className="h-1.5 w-1.5 animate-bounce rounded-full bg-[#8176df]" /></span>Searching policy documents…</span></div></div>}
          {chatError && <InlineError message={chatError} />}
          <div ref={bottomRef} />
        </div>
        <form onSubmit={(event) => { event.preventDefault(); ask(); }} className="border-t border-[#eff0f4] bg-white p-4 sm:px-5"><div className="flex items-end gap-2 rounded-2xl border border-[#e1e4ec] bg-[#fbfbfd] p-2 pl-3 transition focus-within:border-[#aaa2ee] focus-within:ring-4 focus-within:ring-[#6557d9]/10"><textarea rows={1} maxLength={500} value={question} onChange={(event) => setQuestion(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); ask(); } }} placeholder="Ask a policy question…" aria-label="Policy question" className="max-h-28 min-h-[36px] flex-1 resize-y bg-transparent py-2 text-sm text-[#334056] outline-none placeholder:text-[#a2aaba]" /><Button type="submit" disabled={asking || !question.trim()} className="h-9 w-9 shrink-0 !rounded-xl !p-0" aria-label="Send question">{asking ? <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white" /> : <Send className="h-4 w-4" />}</Button></div><p className="mt-2 text-[10px] text-[#a2aaba]">AI answers are based on available policy text. HR remains the source of final guidance.</p></form>
      </Card>
      <aside className={`${mobilePanel === 'library' ? 'flex' : 'hidden xl:flex'} min-h-0 min-w-0 flex-col gap-5 overflow-hidden`}>
        <Card className="flex min-h-0 flex-1 flex-col overflow-hidden"><div className="flex shrink-0 items-center justify-between border-b border-[#eff0f4] px-4 py-4"><div><h2 className="text-sm font-bold text-[#2b3548]">Policy library</h2><p className="mt-1 text-[11px] text-[#929bad]">{documents.length} uploaded {documents.length === 1 ? 'document' : 'documents'}</p></div><span className="grid h-8 w-8 place-items-center rounded-xl bg-[#f4f5f8] text-[#758095]"><FileText className="h-4 w-4" /></span></div>
          {documentsError && <div className="p-3"><InlineError message={documentsError} onRetry={loadDocuments} /></div>}
          {documentsLoading ? <LoadingInline label="Loading policy library" /> : documents.length ? <div className="divide-y divide-[#f0f1f5]">{documents.map((document) => <div key={document.id} className="group flex items-center gap-3 px-4 py-3.5"><div className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-[#f2f0ff] text-[#695cda]"><FileText className="h-4 w-4" /></div><div className="min-w-0 flex-1"><p className="truncate text-xs font-semibold text-[#414c62]">{document.title}</p><p className="mt-1 truncate text-[10px] text-[#969eae]">{document.filename} · {document.chunkCount} chunks</p></div>{user.role === 'hr' && <button onClick={() => setDeleteDoc(document)} title="Delete policy" aria-label={`Delete ${document.title}`} className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-[#a1a8b5] opacity-100 hover:bg-[#fff1f2] hover:text-[#bd4352] sm:opacity-0 sm:group-hover:opacity-100"><Trash2 className="h-3.5 w-3.5" /></button>}</div>)}</div> : <EmptyState icon={FileText} title="No policy documents" description={user.role === 'hr' ? 'Upload a document to make it available to the assistant.' : 'Your HR team has not uploaded policy documents yet.'} action={user.role === 'hr' ? <Button size="sm" onClick={() => setUploadOpen(true)}><UploadCloud className="h-3.5 w-3.5" />Upload policy</Button> : undefined} />}
        </Card>
        <Card className="shrink-0 p-4"><div className="flex items-start gap-3"><span className="grid h-8 w-8 shrink-0 place-items-center rounded-xl bg-[#eef5ff] text-[#5181c4]"><MessageSquareText className="h-4 w-4" /></span><div><h3 className="text-xs font-bold text-[#3d485d]">How answers work</h3><p className="mt-1.5 text-[11px] leading-5 text-[#8791a3]">The assistant searches uploaded policies and cites the source sections. If a document does not support an answer, it will say so.</p></div></div></Card>
      </aside>
    </div>
    {uploadOpen && <UploadModal onClose={() => setUploadOpen(false)} onUploaded={uploaded} />}
    {deleteDoc && <Modal title="Delete policy document" description="This removes the document and its indexed sections from the assistant." onClose={() => setDeleteDoc(null)}><div className="rounded-xl bg-[#faf7f7] p-4 text-sm text-[#59647a]">Delete <strong>{deleteDoc.title}</strong>?</div><div className="mt-5 flex justify-end gap-2"><Button variant="secondary" onClick={() => setDeleteDoc(null)}>Cancel</Button><Button variant="danger" onClick={deleteDocument}><Trash2 className="h-4 w-4" />Delete document</Button></div></Modal>}
  </>;
}

function ChatMessage({ message, user }) {
  if (message.role === 'user') return <div className="flex justify-end gap-2.5"><div className="max-w-[85%] rounded-2xl rounded-tr-md bg-[#6557d9] px-4 py-3 text-sm leading-6 text-white shadow-sm">{message.text}</div><UserAvatar name={user.name} /></div>;
  return <div className="flex items-start gap-3"><div className="grid h-8 w-8 shrink-0 place-items-center rounded-xl bg-[#f0efff] text-[#6557d9]"><Bot className="h-4 w-4" /></div><div className="max-w-[92%] min-w-0"><div className="rounded-2xl rounded-tl-md border border-[#ececf2] bg-white px-4 py-3.5 shadow-[0_2px_8px_rgba(28,37,58,.025)]"><p className="whitespace-pre-wrap text-sm leading-6 text-[#3c475d]">{message.answer}</p></div>{message.sources?.length > 0 && <div className="mt-2 space-y-2">{message.sources.map((source, index) => <div key={`${source.docTitle}-${source.chunkIndex}-${index}`} className="rounded-xl border border-[#e8eaf0] bg-white px-3.5 py-3"><div className="mb-1 flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[.09em] text-[#7669dc]"><Paperclip className="h-3 w-3" />Source {index + 1}</div><p className="text-xs font-semibold text-[#4d5870]">{source.docTitle} <span className="font-normal text-[#929bad]">· Reference {source.chunkIndex + 1}</span></p><p className="mt-1.5 text-[11px] leading-5 text-[#818b9d]">{source.excerpt}</p></div>)}</div>}</div></div>;
}

function UploadModal({ onClose, onUploaded }) {
  const [file, setFile] = useState(null);
  const [title, setTitle] = useState('');
  const [error, setError] = useState('');
  const [uploading, setUploading] = useState(false);
  const submit = async (event) => {
    event.preventDefault(); setError('');
    if (!file) { setError('Choose a PDF, TXT, or Markdown file.'); return; }
    if (file.size > 5 * 1024 * 1024) { setError('The file must be 5 MB or smaller.'); return; }
    setUploading(true);
    const body = new FormData(); body.append('file', file); if (title.trim()) body.append('title', title.trim());
    try { await api.post('/policies', body); onUploaded(); }
    catch (requestError) { setError(getErrorMessage(requestError)); }
    finally { setUploading(false); }
  };
  return <Modal title="Upload policy document" description="The file will be indexed for policy questions." onClose={() => !uploading && onClose()}>
    <form onSubmit={submit} className="space-y-4">
      {error && <InlineError message={error} />}
      <Field label="Document title" maxLength={200} value={title} onChange={(event) => setTitle(event.target.value)} placeholder="e.g. Leave policy" hint="Optional. If blank, the filename is used." />
      <label className="flex min-h-[150px] cursor-pointer flex-col items-center justify-center rounded-2xl border border-dashed border-[#d9dbe6] bg-[#fbfbfe] px-4 text-center transition hover:border-[#a9a2ec] hover:bg-[#f8f7ff]"><input type="file" accept=".pdf,.txt,.md,application/pdf,text/plain,text/markdown" onChange={(event) => setFile(event.target.files?.[0] || null)} className="sr-only" /><span className="mb-3 grid h-10 w-10 place-items-center rounded-xl bg-[#efedff] text-[#6557d9]"><UploadCloud className="h-5 w-5" /></span><span className="text-xs font-semibold text-[#4d5870]">{file ? file.name : 'Choose a policy file'}</span><span className="mt-1 text-[10px] text-[#9aa2b1]">PDF, TXT, Markdown · up to 5 MB</span></label>
      {file && <button type="button" onClick={() => setFile(null)} className="inline-flex items-center gap-1 text-xs font-semibold text-[#9a5962]"><X className="h-3.5 w-3.5" />Remove file</button>}
      <div className="flex justify-end gap-2 border-t border-[#eff0f4] pt-4"><Button type="button" variant="secondary" onClick={onClose} disabled={uploading}>Cancel</Button><Button type="submit" disabled={uploading || !file}>{uploading ? 'Uploading and indexing…' : 'Upload document'}</Button></div>
    </form>
  </Modal>;
}
