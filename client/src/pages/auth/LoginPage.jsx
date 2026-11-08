import { useState } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { ArrowRight, BadgeCheck, Building2, Eye, EyeOff, LockKeyhole, Mail, ShieldCheck } from 'lucide-react';
import { Button, InlineError, LoadingScreen } from '../../components/common/Ui.jsx';
import { getErrorMessage } from '../../api/client.js';
import { useAuth } from '../../context/AuthContext.jsx';

export default function LoginPage() {
  const { user, loading, login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [form, setForm] = useState({ email: '', password: '' });
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  if (loading) return <LoadingScreen label="Loading NivHR" />;
  if (user) return <Navigate to="/dashboard" replace />;

  const handleSubmit = async (event) => {
    event.preventDefault();
    setError('');
    setSubmitting(true);
    try {
      await login({ email: form.email.trim(), password: form.password });
      navigate(location.state?.from || '/dashboard', { replace: true });
    } catch (requestError) {
      setError(requestError.response?.status === 401 ? 'The email or password does not match our records.' : getErrorMessage(requestError));
    } finally {
      setSubmitting(false);
    }
  };

  return <main className="grid min-h-screen bg-white lg:grid-cols-[1.06fr_.94fr]">
    <section className="relative hidden overflow-hidden bg-[#191b32] px-12 py-10 text-white lg:flex lg:flex-col xl:px-20">
      <div className="absolute -right-28 -top-32 h-[430px] w-[430px] rounded-full border border-white/10" />
      <div className="absolute -right-10 -top-14 h-[280px] w-[280px] rounded-full border border-white/10" />
      <div className="absolute -bottom-48 -left-16 h-[540px] w-[540px] rounded-full border border-white/10" />
      <div className="relative flex items-center gap-3"><div className="grid h-10 w-10 place-items-center rounded-xl bg-[#7164ea]"><Building2 className="h-5 w-5" /></div><div><p className="text-lg font-extrabold tracking-[-.04em]">nivHR</p><p className="text-[9px] font-semibold tracking-[.18em] text-white/50">PEOPLE OPERATIONS</p></div></div>
      <div className="relative my-auto max-w-xl py-16">
        <div className="mb-7 inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[.06] px-3 py-1.5 text-xs font-medium text-[#d2cdfd]"><span className="h-1.5 w-1.5 rounded-full bg-[#a9a0ff]" /> A calmer way to work</div>
        <h1 className="max-w-lg text-4xl font-semibold leading-[1.13] tracking-[-.05em] xl:text-[52px]">People work,<br /><span className="text-[#aaa2ff]">in good order.</span></h1>
        <p className="mt-6 max-w-md text-sm leading-7 text-white/60">One thoughtful workspace for employee records, leave, and the policies that guide your team.</p>
        <div className="mt-10 grid max-w-md grid-cols-2 gap-3">
          <div className="rounded-2xl border border-white/10 bg-white/[.05] p-4"><div className="mb-3 grid h-8 w-8 place-items-center rounded-xl bg-[#7770e8]/20 text-[#bbb5ff]"><ShieldCheck className="h-4 w-4" /></div><p className="text-sm font-semibold">Thoughtful by design</p><p className="mt-1 text-xs leading-5 text-white/45">The right access for every role.</p></div>
          <div className="rounded-2xl border border-white/10 bg-white/[.05] p-4"><div className="mb-3 grid h-8 w-8 place-items-center rounded-xl bg-[#7770e8]/20 text-[#bbb5ff]"><BadgeCheck className="h-4 w-4" /></div><p className="text-sm font-semibold">Clear by default</p><p className="mt-1 text-xs leading-5 text-white/45">Real information, easy to find.</p></div>
        </div>
      </div>
      <p className="relative text-xs text-white/35">NivHR · People operations workspace</p>
    </section>
    <section className="flex min-h-screen items-center justify-center px-5 py-12 sm:px-10">
      <div className="w-full max-w-[410px]">
        <div className="mb-10 flex items-center gap-3 lg:hidden"><div className="grid h-10 w-10 place-items-center rounded-xl bg-[#6254d4] text-white"><Building2 className="h-5 w-5" /></div><div><p className="text-lg font-extrabold tracking-[-.04em] text-[#202a3b]">niv<span className="text-[#6557d9]">HR</span></p><p className="text-[9px] font-semibold tracking-[.16em] text-[#9aa2b1]">PEOPLE OPERATIONS</p></div></div>
        <div className="mb-8"><p className="mb-2 text-xs font-bold uppercase tracking-[.16em] text-[#7568dc]">Welcome back</p><h2 className="text-[30px] font-bold tracking-[-.045em] text-[#202a3b]">Sign in to NivHR</h2><p className="mt-2 text-sm text-[#7d8799]">Use your work account to continue.</p></div>
        {error && <div className="mb-5"><InlineError message={error} /></div>}
        <form onSubmit={handleSubmit} className="space-y-5">
          <label className="block"><span className="mb-2 block text-xs font-semibold text-[#485267]">Work email</span><span className="relative block"><Mail className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-[#9aa2b1]" /><input type="email" autoComplete="username" required value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} placeholder="you@company.com" className="w-full rounded-xl border border-[#dfe3eb] bg-white py-3 pl-10 pr-4 text-sm outline-none transition placeholder:text-[#a3aabb] focus:border-[#8b82e8] focus:ring-4 focus:ring-[#6557d9]/10" /></span></label>
          <label className="block"><span className="mb-2 block text-xs font-semibold text-[#485267]">Password</span><span className="relative block"><LockKeyhole className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-[#9aa2b1]" /><input type={showPassword ? 'text' : 'password'} autoComplete="current-password" required value={form.password} onChange={(event) => setForm({ ...form, password: event.target.value })} placeholder="Enter your password" className="w-full rounded-xl border border-[#dfe3eb] bg-white py-3 pl-10 pr-12 text-sm outline-none transition placeholder:text-[#a3aabb] focus:border-[#8b82e8] focus:ring-4 focus:ring-[#6557d9]/10" /><button type="button" aria-label={showPassword ? 'Hide password' : 'Show password'} onClick={() => setShowPassword(!showPassword)} className="absolute right-3 top-1/2 -translate-y-1/2 rounded-md p-1 text-[#929bad] hover:text-[#5143c6]">{showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}</button></span></label>
          <Button type="submit" disabled={submitting} className="mt-2 w-full py-3">{submitting ? 'Signing in…' : 'Sign in'}{!submitting && <ArrowRight className="h-4 w-4" />}</Button>
        </form>
        <div className="mt-7 flex items-start gap-2 rounded-xl bg-[#f7f7fb] p-3.5 text-xs leading-5 text-[#858ea0]"><ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-[#7164d6]" /><p>Access is provided by your HR team. NivHR does not offer public registration.</p></div>
        <p className="mt-8 text-center text-[11px] text-[#a4abba]">Secure sign-in · HR and employee accounts</p>
      </div>
    </section>
  </main>;
}
