import { useEffect } from 'react';
import { AlertCircle, Check, LoaderCircle, X } from 'lucide-react';
import { initials } from '../../utils/format.js';

const buttonStyles = {
  primary: 'bg-[#6557d9] text-white shadow-sm hover:bg-[#5143c6] focus-visible:ring-[#9188ee]',
  secondary: 'border border-[#e2e5ec] bg-white text-[#343d50] hover:bg-[#f8f9fc] focus-visible:ring-[#c9c5f7]',
  subtle: 'text-[#69748a] hover:bg-[#f1f2f7] hover:text-[#252e40] focus-visible:ring-[#c9c5f7]',
  danger: 'bg-[#c84055] text-white hover:bg-[#ae3043] focus-visible:ring-[#ef9aa7]',
};

export function Button({ variant = 'primary', size = 'md', className = '', children, ...props }) {
  const sizes = size === 'sm' ? 'px-3 py-2 text-xs' : 'px-4 py-2.5 text-sm';
  return <button className={`inline-flex items-center justify-center gap-2 rounded-xl font-semibold transition focus-visible:outline-none focus-visible:ring-4 disabled:cursor-not-allowed disabled:opacity-50 ${buttonStyles[variant]} ${sizes} ${className}`} {...props}>{children}</button>;
}

export function PageHeader({ eyebrow, title, description, actions }) {
  return (
    <div className="mb-7 flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
      <div>
        {eyebrow && <p className="mb-2 text-xs font-semibold uppercase tracking-[.16em] text-[#7668df]">{eyebrow}</p>}
        <h1 className="text-[26px] font-bold tracking-[-.04em] text-[#172033] sm:text-[30px]">{title}</h1>
        {description && <p className="mt-1.5 max-w-2xl text-sm leading-6 text-[#788297]">{description}</p>}
      </div>
      {actions && <div className="flex shrink-0 flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

export function Card({ className = '', children, ...props }) {
  return <section className={`rounded-2xl border border-[#e8eaf0] bg-white shadow-[0_2px_9px_rgba(29,39,62,.025)] ${className}`} {...props}>{children}</section>;
}

export function StatusBadge({ status }) {
  const styles = {
    pending: 'bg-[#fff7e9] text-[#a5680b] ring-[#f4e4c3]',
    approved: 'bg-[#eaf8f0] text-[#1f8651] ring-[#d3efdf]',
    rejected: 'bg-[#fff0f1] text-[#bf4552] ring-[#f6dade]',
    cancelled: 'bg-[#f0f1f5] text-[#667085] ring-[#e1e3e9]',
    active: 'bg-[#eaf8f0] text-[#1f8651] ring-[#d3efdf]',
    inactive: 'bg-[#f0f1f5] text-[#667085] ring-[#e1e3e9]',
  };
  const label = status ? status[0].toUpperCase() + status.slice(1) : 'Unknown';
  return <span className={`inline-flex items-center rounded-full px-2.5 py-1 text-[11px] font-semibold capitalize ring-1 ring-inset ${styles[status] || 'bg-[#f0f1f5] text-[#667085] ring-[#e1e3e9]'}`}>{label}</span>;
}

export function LoadingScreen({ label = 'Loading' }) {
  return <div className="flex min-h-screen items-center justify-center bg-[#f7f8fb] text-sm text-[#69748a]"><LoaderCircle className="mr-2 h-4 w-4 animate-spin text-[#6557d9]" />{label}</div>;
}

export function LoadingInline({ label = 'Loading data' }) {
  return <div className="flex items-center justify-center gap-2 py-12 text-sm text-[#7c8698]"><LoaderCircle className="h-4 w-4 animate-spin text-[#6557d9]" />{label}</div>;
}

export function EmptyState({ icon: Icon = Check, title, description, action }) {
  return <div className="flex flex-col items-center px-6 py-12 text-center">
    <div className="mb-4 grid h-12 w-12 place-items-center rounded-2xl bg-[#f3f2ff] text-[#695bdb]"><Icon className="h-5 w-5" /></div>
    <h3 className="text-sm font-semibold text-[#2b3548]">{title}</h3>
    {description && <p className="mt-1 max-w-sm text-sm leading-6 text-[#7c8698]">{description}</p>}
    {action && <div className="mt-4">{action}</div>}
  </div>;
}

export function InlineError({ message, onRetry }) {
  return <div role="alert" className="flex items-start gap-3 rounded-xl border border-[#f2d5da] bg-[#fff8f8] p-4 text-sm text-[#8e3744]">
    <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
    <div className="flex-1">{message}</div>
    {onRetry && <button type="button" onClick={onRetry} className="font-semibold underline underline-offset-2">Retry</button>}
  </div>;
}

export function Field({ label, hint, className = '', ...props }) {
  const { as, type, className: controlClass = '', children, ...controlProps } = props;
  const classes = `w-full rounded-xl border border-[#dfe3eb] bg-white px-3.5 py-2.5 text-sm text-[#283247] outline-none transition placeholder:text-[#a3aabb] focus:border-[#9188ee] focus:ring-4 focus:ring-[#6557d9]/10 ${controlClass}`;
  return <label className={`block ${className}`}>
    <span className="mb-1.5 block text-xs font-semibold text-[#485267]">{label}</span>
    {as === 'textarea' ? <textarea {...controlProps} className={`min-h-[104px] py-3 ${classes}`} /> :
      as === 'select' ? <select {...controlProps} className={classes}>{children}</select> :
        <input {...controlProps} type={type} className={classes} />}
    {hint && <span className="mt-1.5 block text-xs text-[#8992a3]">{hint}</span>}
  </label>;
}

export function Modal({ title, description, onClose, children, size = 'max-w-lg' }) {
  useEffect(() => {
    const onKeyDown = (event) => { if (event.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);
  return <div className="fixed inset-0 z-[60] flex items-end justify-center bg-[#10172a]/45 p-0 backdrop-blur-[2px] sm:items-center sm:p-5" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <section role="dialog" aria-modal="true" aria-labelledby="modal-title" className={`max-h-[92vh] w-full overflow-y-auto rounded-t-3xl border border-[#e9eaf0] bg-white shadow-2xl sm:rounded-2xl ${size}`}>
      <div className="flex items-start justify-between gap-4 border-b border-[#eff0f4] px-5 py-4 sm:px-6">
        <div><h2 id="modal-title" className="text-lg font-bold tracking-tight text-[#202a3b]">{title}</h2>{description && <p className="mt-1 text-sm text-[#798398]">{description}</p>}</div>
        <button type="button" onClick={onClose} aria-label="Close dialog" className="rounded-lg p-2 text-[#8a93a4] hover:bg-[#f1f2f7]"><X className="h-4 w-4" /></button>
      </div>
      <div className="p-5 sm:p-6">{children}</div>
    </section>
  </div>;
}

export function UserAvatar({ name, size = 'md' }) {
  const dimension = size === 'lg' ? 'h-14 w-14 text-base' : 'h-9 w-9 text-xs';
  return <div className={`grid shrink-0 place-items-center rounded-full bg-[#eeeaff] font-bold text-[#594bc7] ring-1 ring-[#e2defd] ${dimension}`} aria-label={name || 'User'}>{initials(name)}</div>;
}

export function IconButton({ label, children, ...props }) {
  return <button aria-label={label} title={label} className="grid h-9 w-9 place-items-center rounded-xl text-[#6e788c] transition hover:bg-[#f0effd] hover:text-[#594bc7] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#6557d9]/15" {...props}>{children}</button>;
}
