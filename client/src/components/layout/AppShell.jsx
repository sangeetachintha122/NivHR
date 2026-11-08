import { useMemo, useState } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import {
  Activity, Bot, Building2, CalendarDays, ChartNoAxesCombined, ChevronDown,
  ChevronRight, CircleUserRound, LayoutDashboard, LogOut, Menu, PanelLeftClose,
  PanelLeftOpen, Settings2, ShieldCheck, Users, X,
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext.jsx';
import { initials } from '../../utils/format.js';

const baseNavigation = [
  { label: 'Overview', to: '/dashboard', icon: LayoutDashboard },
  { label: 'Leave management', to: '/leaves', icon: CalendarDays },
  { label: 'Attendance', to: '/attendance', icon: Activity },
  { label: 'Policy assistant', to: '/policy', icon: Bot },
];

const hrNavigation = [
  { label: 'Employees', to: '/employees', icon: Users },
  { label: 'AI leave review', to: '/ai-leave-review', icon: ShieldCheck },
  { label: 'HR analytics', to: '/analytics', icon: ChartNoAxesCombined },
];

const titleFromPath = (path) => {
  if (path.startsWith('/employees/')) return 'Employee profile';
  return ({
    '/dashboard': 'Overview', '/employees': 'Employees', '/leaves': 'Leave management',
    '/attendance': 'Attendance', '/policy': 'Policy assistant', '/ai-leave-review': 'AI leave review',
    '/analytics': 'HR analytics', '/profile': 'Profile & settings',
  })[path] || 'NivHR';
};

export default function AppShell() {
  const { user, logout } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const title = useMemo(() => titleFromPath(location.pathname), [location.pathname]);
  const navigation = user?.role === 'hr' ? [...baseNavigation.slice(0, 1), ...hrNavigation.slice(0, 1), ...baseNavigation.slice(1), ...hrNavigation.slice(1)] : baseNavigation;

  const handleLogout = () => { logout(); navigate('/login', { replace: true }); };
  const sidebarContent = (compact = false) => (
    <>
      <Link to="/dashboard" onClick={() => setMobileOpen(false)} className={`flex h-[72px] items-center gap-3 border-b border-[#eef0f4] px-5 ${compact ? 'justify-center px-2' : ''}`}>
        <div className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-[#6254d4] text-white shadow-[0_6px_16px_rgba(98,84,212,.22)]"><Building2 className="h-[18px] w-[18px]" /></div>
        {!compact && <div className="min-w-0"><p className="text-[17px] font-extrabold tracking-[-.04em] text-[#222b3d]">niv<span className="text-[#6557d9]">HR</span></p><p className="-mt-0.5 text-[10px] font-medium tracking-[.13em] text-[#929bad]">PEOPLE OPERATIONS</p></div>}
      </Link>
      <div className={`px-3 pt-6 ${compact ? 'px-2' : ''}`}>
        {!compact && <p className="mb-2 px-3 text-[10px] font-bold uppercase tracking-[.15em] text-[#a0a7b5]">Workspace</p>}
        <nav aria-label="Main navigation" className="space-y-1">
          {navigation.map(({ label, to, icon: Icon }) => <NavLink key={to} to={to} onClick={() => setMobileOpen(false)} title={compact ? label : undefined} className={({ isActive }) => `group flex items-center gap-3 rounded-xl px-3 py-2.5 text-[13px] font-semibold transition ${compact ? 'justify-center px-2' : ''} ${isActive ? 'bg-[#f0efff] text-[#594bc7]' : 'text-[#778197] hover:bg-[#f7f7fa] hover:text-[#313b4e]'}`}>
            {({ isActive }) => <><Icon className={`h-[17px] w-[17px] shrink-0 ${isActive ? 'text-[#6557d9]' : 'text-[#929bad] group-hover:text-[#7063d8]'}`} /><span className={compact ? 'sr-only' : ''}>{label}</span>{isActive && !compact && <span className="ml-auto h-1.5 w-1.5 rounded-full bg-[#6557d9]" />}</>}
          </NavLink>)}
        </nav>
      </div>
      <div className="mt-auto p-3">
        <div className={`rounded-2xl border border-[#ececf3] bg-[#fafaff] p-3 ${compact ? 'hidden' : ''}`}>
          <div className="mb-2 flex items-center gap-2"><div className="grid h-7 w-7 place-items-center rounded-lg bg-[#efedff] text-[#6557d9]"><ShieldCheck className="h-3.5 w-3.5" /></div><p className="text-xs font-semibold text-[#434d62]">Your workspace</p></div>
          <p className="text-[11px] leading-5 text-[#8b94a5]">People operations, made clear.</p>
        </div>
        <button type="button" onClick={() => navigate('/profile')} title={compact ? 'Profile & settings' : undefined} className={`mt-3 flex w-full items-center gap-3 rounded-xl px-2.5 py-2 text-left hover:bg-[#f7f7fa] ${compact ? 'justify-center' : ''}`}>
          <div className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-[#eeeaff] text-[10px] font-bold text-[#594bc7]">{initials(user?.name)}</div>
          {!compact && <div className="min-w-0 flex-1"><p className="truncate text-xs font-semibold text-[#394459]">{user?.name}</p><p className="truncate text-[10px] capitalize text-[#929bad]">{user?.role} account</p></div>}
          {!compact && <Settings2 className="h-4 w-4 text-[#a1a8b5]" />}
        </button>
      </div>
    </>
  );

  const isPolicyPage = location.pathname === '/policy';

  return <div className="flex h-dvh overflow-hidden bg-[#f7f8fb] text-[#172033]">
    <aside className={`fixed inset-y-0 left-0 z-40 hidden flex-col border-r border-[#e9ebf1] bg-white transition-all duration-200 lg:flex ${collapsed ? 'w-[76px]' : 'w-[252px]'}`}>{sidebarContent(collapsed)}</aside>
    {mobileOpen && <div className="fixed inset-0 z-50 lg:hidden"><button className="absolute inset-0 bg-[#131a2b]/40" aria-label="Close navigation overlay" onClick={() => setMobileOpen(false)} /><aside className="relative flex h-full w-[min(82vw,290px)] flex-col bg-white shadow-2xl">{sidebarContent(false)}<button aria-label="Close navigation" onClick={() => setMobileOpen(false)} className="absolute right-3 top-5 rounded-lg p-2 text-[#929bad]"><X className="h-4 w-4" /></button></aside></div>}
    <div className={`flex h-full min-h-0 min-w-0 flex-1 flex-col transition-[padding] duration-200 ${collapsed ? 'lg:pl-[76px]' : 'lg:pl-[252px]'}`}>
      <header className="relative z-30 flex h-[72px] shrink-0 items-center justify-between border-b border-[#e9ebf1] bg-white/90 px-4 backdrop-blur-xl sm:px-7 lg:px-9">
        <div className="flex min-w-0 items-center gap-3">
          <button aria-label="Open navigation" onClick={() => setMobileOpen(true)} className="grid h-9 w-9 place-items-center rounded-xl text-[#667085] hover:bg-[#f2f3f7] lg:hidden"><Menu className="h-[18px] w-[18px]" /></button>
          <button aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'} onClick={() => setCollapsed(!collapsed)} className="hidden h-9 w-9 place-items-center rounded-xl text-[#8b94a5] hover:bg-[#f2f3f7] lg:grid">{collapsed ? <PanelLeftOpen className="h-4 w-4" /> : <PanelLeftClose className="h-4 w-4" />}</button>
          <div className="min-w-0"><p className="hidden text-[10px] font-medium text-[#9aa2b1] sm:block">Workspace <ChevronRight className="mx-1 inline h-3 w-3" /> {title}</p><h2 className="truncate text-sm font-bold text-[#273145] sm:mt-1">{title}</h2></div>
        </div>
        <div className="flex items-center gap-2 sm:gap-3">
          <div className="relative">
            <button onClick={() => setProfileOpen(!profileOpen)} className="flex items-center gap-2 rounded-xl p-1.5 pr-2 hover:bg-[#f7f7fa]" aria-expanded={profileOpen} aria-label="Open user menu">
              <div className="grid h-8 w-8 place-items-center rounded-full bg-[#eeeaff] text-[10px] font-bold text-[#594bc7]">{initials(user?.name)}</div>
              <span className="hidden max-w-[120px] truncate text-xs font-semibold text-[#465167] sm:block">{user?.name}</span><ChevronDown className="hidden h-3.5 w-3.5 text-[#929bad] sm:block" />
            </button>
            {profileOpen && <><button className="fixed inset-0 z-10 cursor-default" aria-label="Close user menu" onClick={() => setProfileOpen(false)} /><div className="absolute right-0 z-20 mt-2 w-56 rounded-2xl border border-[#e8eaf0] bg-white p-2 shadow-xl">
              <div className="border-b border-[#eff0f4] px-3 py-2.5"><p className="truncate text-sm font-semibold text-[#303a4d]">{user?.name}</p><p className="truncate text-xs text-[#8791a3]">{user?.email}</p></div>
              <Link to="/profile" onClick={() => setProfileOpen(false)} className="mt-1 flex items-center gap-2 rounded-xl px-3 py-2.5 text-xs font-medium text-[#59647a] hover:bg-[#f6f6fa]"><CircleUserRound className="h-4 w-4" />Profile & settings</Link>
              <button onClick={handleLogout} className="flex w-full items-center gap-2 rounded-xl px-3 py-2.5 text-left text-xs font-semibold text-[#bb4654] hover:bg-[#fff4f4]"><LogOut className="h-4 w-4" />Sign out</button>
            </div></>}
          </div>
        </div>
      </header>
      <main className={`mx-auto flex w-full max-w-[1500px] min-h-0 flex-1 flex-col px-4 py-5 sm:px-7 sm:py-6 lg:px-9 lg:py-7 ${isPolicyPage ? 'overflow-hidden' : 'overflow-y-auto'}`}>
        <div className={isPolicyPage ? 'flex min-h-0 min-w-0 flex-1 flex-col' : ''}><Outlet /></div>
      </main>
    </div>
  </div>;
}
