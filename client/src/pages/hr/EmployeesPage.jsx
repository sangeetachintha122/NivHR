import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, ArrowRight, Eye, Filter, Mail, Plus, Search, UserRound, UserRoundX } from 'lucide-react';
import { api, getErrorMessage } from '../../api/client.js';
import { getAllEmployees } from '../../api/resources.js';
import { formatDate } from '../../utils/format.js';
import { Button, Card, EmptyState, InlineError, LoadingInline, Modal, PageHeader, StatusBadge } from '../../components/common/Ui.jsx';
import EmployeeFormModal from '../../components/employees/EmployeeFormModal.jsx';

export default function EmployeesPage() {
  const [employees, setEmployees] = useState([]);
  const [pagination, setPagination] = useState({ page: 1, totalPages: 1, total: 0 });
  const [departments, setDepartments] = useState([]);
  const [filters, setFilters] = useState({ search: '', department: '', isActive: '' });
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [modal, setModal] = useState(null);
  const [deactivating, setDeactivating] = useState(false);
  const [notice, setNotice] = useState('');

  const params = useMemo(() => ({ page, limit: 10, ...(filters.search ? { search: filters.search } : {}), ...(filters.department ? { department: filters.department } : {}), ...(filters.isActive ? { isActive: filters.isActive } : {}) }), [page, filters]);
  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const { data } = await api.get('/employees', { params });
      setEmployees(data.employees); setPagination(data.pagination);
    } catch (requestError) { setError(getErrorMessage(requestError)); }
    finally { setLoading(false); }
  }, [params]);

  useEffect(() => { const timeout = setTimeout(load, filters.search ? 250 : 0); return () => clearTimeout(timeout); }, [load, filters.search]);
  useEffect(() => {
    getAllEmployees().then(({ employees: all }) => setDepartments([...new Set(all.map((employee) => employee.department).filter(Boolean))].sort())).catch(() => {});
  }, []);

  const setFilter = (key, value) => { setPage(1); setFilters((current) => ({ ...current, [key]: value })); };
  const handleSaved = (employee) => {
    setModal(null); setNotice(`Employee ${employee.name} saved.`); load();
  };
  const confirmDeactivate = async () => {
    setDeactivating(true);
    try {
      await api.patch(`/employees/${modal.id}/deactivate`);
      setModal(null); setNotice('Employee deactivated.'); load();
    } catch (requestError) { setError(getErrorMessage(requestError)); setModal(null); }
    finally { setDeactivating(false); }
  };

  return <>
    <PageHeader eyebrow="People directory" title="Employees" description="Manage employee accounts and keep your directory up to date." actions={<Button onClick={() => setModal({ type: 'create' })}><Plus className="h-4 w-4" />Add employee</Button>} />
    {notice && <div className="mb-4 flex items-center justify-between rounded-xl border border-[#d6eddf] bg-[#f1faf4] px-4 py-3 text-sm text-[#27714b]" role="status">{notice}<button onClick={() => setNotice('')} className="text-xs font-semibold">Dismiss</button></div>}
    {error && <div className="mb-4"><InlineError message={error} onRetry={load} /></div>}
    <Card className="overflow-hidden">
      <div className="flex flex-col gap-3 border-b border-[#eff0f4] p-4 sm:flex-row sm:items-center sm:p-5">
        <div className="relative min-w-0 flex-1 sm:max-w-[360px]"><Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#9ba3b2]" /><input aria-label="Search employees" value={filters.search} onChange={(event) => setFilter('search', event.target.value)} placeholder="Search name or email" className="w-full rounded-xl border border-[#e3e6ed] bg-[#fcfcfd] py-2.5 pl-9 pr-3 text-xs outline-none focus:border-[#9188ee] focus:ring-4 focus:ring-[#6557d9]/10" /></div>
        <div className="flex flex-wrap gap-2">
          <label className="flex items-center gap-2 rounded-xl border border-[#e3e6ed] bg-white px-3 text-xs text-[#69748a]"><Filter className="h-3.5 w-3.5" /><select aria-label="Filter by department" value={filters.department} onChange={(event) => setFilter('department', event.target.value)} className="max-w-[150px] bg-transparent py-2.5 outline-none"><option value="">All departments</option>{departments.map((department) => <option key={department} value={department}>{department}</option>)}</select></label>
          <label className="flex items-center gap-2 rounded-xl border border-[#e3e6ed] bg-white px-3 text-xs text-[#69748a]"><select aria-label="Filter by active status" value={filters.isActive} onChange={(event) => setFilter('isActive', event.target.value)} className="bg-transparent py-2.5 outline-none"><option value="">All statuses</option><option value="true">Active</option><option value="false">Inactive</option></select></label>
          <span className="ml-auto self-center text-xs text-[#919aab]">{pagination.total} {pagination.total === 1 ? 'employee' : 'employees'}</span>
        </div>
      </div>
      {loading ? <LoadingInline label="Loading employees" /> : employees.length ? <>
        <div className="overflow-x-auto app-scrollbar"><table className="w-full min-w-[780px] text-left"><thead><tr className="bg-[#fafbfc] text-[10px] font-bold uppercase tracking-[.1em] text-[#9aa2b1]"><th className="px-5 py-3.5 sm:px-6">Employee</th><th className="px-5 py-3.5">Department</th><th className="px-5 py-3.5">Join date</th><th className="px-5 py-3.5">Status</th><th className="px-5 py-3.5 text-right">Actions</th></tr></thead><tbody className="divide-y divide-[#f0f1f5]">{employees.map((employee) => <tr key={employee.id} className="text-xs hover:bg-[#fcfcfe]"><td className="px-5 py-3.5 sm:px-6"><Link to={`/employees/${employee.id}`} className="flex items-center gap-3"><span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-[#f0efff] text-[10px] font-bold text-[#6659d3]">{employee.name.split(/\s+/).slice(0,2).map((part)=>part[0]).join('').toUpperCase()}</span><span><span className="block font-semibold text-[#364055] hover:text-[#6557d9]">{employee.name}</span><span className="mt-0.5 flex items-center gap-1 text-[11px] text-[#929bad]"><Mail className="h-3 w-3" />{employee.email}</span></span></Link></td><td className="px-5 py-3.5 text-[#59647a]">{employee.department || 'Unassigned'}</td><td className="px-5 py-3.5 text-[#59647a]">{formatDate(employee.joinDate)}</td><td className="px-5 py-3.5"><StatusBadge status={employee.isActive ? 'active' : 'inactive'} /></td><td className="px-5 py-3.5"><div className="flex justify-end gap-1"><Link aria-label={`View ${employee.name}`} title="View profile" to={`/employees/${employee.id}`} className="grid h-8 w-8 place-items-center rounded-lg text-[#7e889b] hover:bg-[#f0efff] hover:text-[#6557d9]"><Eye className="h-4 w-4" /></Link><button aria-label={`Edit ${employee.name}`} title="Edit employee" onClick={() => setModal({ type: 'edit', employee })} className="grid h-8 w-8 place-items-center rounded-lg text-[#7e889b] hover:bg-[#f0efff] hover:text-[#6557d9]"><UserRound className="h-4 w-4" /></button>{employee.isActive && <button aria-label={`Deactivate ${employee.name}`} title="Deactivate employee" onClick={() => setModal({ type: 'deactivate', id: employee.id, name: employee.name })} className="grid h-8 w-8 place-items-center rounded-lg text-[#9a7580] hover:bg-[#fff1f2] hover:text-[#bd4352]"><UserRoundX className="h-4 w-4" /></button>}</div></td></tr>)}</tbody></table></div>
        <div className="flex items-center justify-between border-t border-[#eff0f4] px-5 py-3.5 sm:px-6"><p className="text-xs text-[#8b94a5]">Page {pagination.page} of {Math.max(pagination.totalPages, 1)}</p><div className="flex gap-2"><Button variant="secondary" size="sm" disabled={pagination.page <= 1 || loading} onClick={() => setPage((current) => Math.max(1, current - 1))}><ArrowLeft className="h-3.5 w-3.5" />Previous</Button><Button variant="secondary" size="sm" disabled={pagination.page >= pagination.totalPages || loading} onClick={() => setPage((current) => current + 1)}>Next<ArrowRight className="h-3.5 w-3.5" /></Button></div></div>
      </> : <EmptyState icon={UserRound} title="No employees found" description={filters.search || filters.department || filters.isActive ? 'Try changing your search or filters.' : 'Add your first employee to start building the team directory.'} action={!filters.search && !filters.department && !filters.isActive ? <Button size="sm" onClick={() => setModal({ type: 'create' })}><Plus className="h-4 w-4" />Add employee</Button> : undefined} />}
    </Card>
    {modal?.type === 'create' && <EmployeeFormModal onClose={() => setModal(null)} onSaved={handleSaved} />}
    {modal?.type === 'edit' && <EmployeeFormModal employee={modal.employee} onClose={() => setModal(null)} onSaved={handleSaved} />}
    {modal?.type === 'deactivate' && <Modal title="Deactivate employee" description="The employee will no longer be able to sign in. Their records will remain available." onClose={() => !deactivating && setModal(null)}><div className="rounded-xl bg-[#faf7f7] p-4 text-sm text-[#59647a]">Deactivate <strong>{modal.name}</strong>?</div><div className="mt-5 flex justify-end gap-2"><Button variant="secondary" onClick={() => setModal(null)} disabled={deactivating}>Cancel</Button><Button variant="danger" onClick={confirmDeactivate} disabled={deactivating}>{deactivating ? 'Deactivating…' : 'Deactivate'}</Button></div></Modal>}
  </>;
}
