import { useCallback, useEffect, useState } from 'react';
import { Save, Users } from 'lucide-react';
import { api, getErrorMessage } from '../../api/client.js';
import { Button, Card, EmptyState, Field, InlineError, LoadingInline, PageHeader } from '../../components/common/Ui.jsx';

export default function DepartmentCapacityPage() {
  const [departments, setDepartments] = useState([]);
  const [values, setValues] = useState({});
  const [loading, setLoading] = useState(true);
  const [savingDepartment, setSavingDepartment] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const fetchDepartments = useCallback(async () => {
    const { data } = await api.get('/capacity');
    return data.departments || [];
  }, []);

  useEffect(() => {
    let active = true;
    fetchDepartments()
      .then((items) => {
        if (!active) return;
        setDepartments(items);
        setValues(Object.fromEntries(items.map((item) => [
          item.department,
          item.configured ? String(item.maxSimultaneousAbsent) : '',
        ])));
      })
      .catch((requestError) => {
        if (active) setError(getErrorMessage(requestError));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => { active = false; };
  }, [fetchDepartments]);

  const retryLoad = () => {
    setLoading(true);
    setError('');
    fetchDepartments()
      .then((items) => {
        setDepartments(items);
        setValues(Object.fromEntries(items.map((item) => [
          item.department,
          item.configured ? String(item.maxSimultaneousAbsent) : '',
        ])));
      })
      .catch((requestError) => setError(getErrorMessage(requestError)))
      .finally(() => setLoading(false));
  };

  const save = async (department) => {
    const rawValue = values[department];
    const limit = Number(rawValue);
    const row = departments.find((item) => item.department === department);
    if (rawValue === '' || !Number.isInteger(limit) || limit < 0 || limit > row.activeHeadcount) {
      setError(`Enter a whole number from 0 to ${row.activeHeadcount} for ${department}.`);
      setNotice('');
      return;
    }

    setSavingDepartment(department);
    setError('');
    setNotice('');
    try {
      const { data } = await api.put(`/capacity/${encodeURIComponent(department)}`, {
        maxSimultaneousAbsent: limit,
      });
      setDepartments((current) => current.map((item) => item.department === department ? data.capacity : item));
      setNotice(`${department} capacity saved.`);
    } catch (requestError) {
      setError(getErrorMessage(requestError));
    } finally {
      setSavingDepartment('');
    }
  };

  return <>
    <PageHeader eyebrow="HR settings" title="Department Capacity" description="Set the maximum number of employees who may be absent at the same time in each department." />
    {notice && <div role="status" className="mb-4 rounded-xl border border-[#d6eddf] bg-[#f1faf4] px-4 py-3 text-sm text-[#27714b]">{notice}</div>}
    {error && <div className="mb-4"><InlineError message={error} onRetry={retryLoad} /></div>}
    <Card className="overflow-hidden">
      <div className="border-b border-[#eff0f4] px-5 py-4"><h2 className="text-sm font-bold text-[#2b3548]">Department limits</h2><p className="mt-1 text-xs text-[#929bad]">Limits are integer employee counts. Active headcount comes from current employee records.</p></div>
      {loading ? <LoadingInline label="Loading department capacity" /> : departments.length ? <div className="divide-y divide-[#f0f1f5]">{departments.map((item) => <div key={item.department} className="grid gap-4 px-5 py-4 sm:grid-cols-[minmax(0,1fr)_auto_minmax(180px,240px)_auto] sm:items-center">
        <div className="min-w-0"><h3 className="truncate text-sm font-semibold text-[#354056]">{item.department}</h3><p className="mt-1 text-xs text-[#8791a3]">{item.configured ? 'Configured' : 'Not configured'}</p></div>
        <div className="flex items-center gap-2 text-xs text-[#69748a]"><Users className="h-4 w-4 text-[#929bad]" /><span>{item.activeHeadcount} active {item.activeHeadcount === 1 ? 'employee' : 'employees'}</span></div>
        <Field
          label="Maximum simultaneous absences"
          type="number"
          min="0"
          max={item.activeHeadcount}
          step="1"
          value={values[item.department] ?? ''}
          onChange={(event) => setValues((current) => ({ ...current, [item.department]: event.target.value }))}
          hint={`Enter 0 to ${item.activeHeadcount}`}
        />
        <Button size="sm" onClick={() => save(item.department)} disabled={savingDepartment === item.department}>
          <Save className="h-3.5 w-3.5" />{savingDepartment === item.department ? 'Saving…' : 'Save'}
        </Button>
      </div>)}</div> : <EmptyState icon={Users} title="No departments found" description="Add departments to employee records to configure capacity." />}
    </Card>
  </>;
}
