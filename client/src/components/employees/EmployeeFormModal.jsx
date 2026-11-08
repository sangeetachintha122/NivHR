import { useState } from 'react';
import { api, getErrorMessage } from '../../api/client.js';
import { Button, Field, InlineError, Modal } from '../common/Ui.jsx';

export default function EmployeeFormModal({ employee, onClose, onSaved }) {
  const editing = Boolean(employee);
  const [form, setForm] = useState({
    name: employee?.name || '', email: employee?.email || '', password: '',
    department: employee?.department || '',
    joinDate: employee?.joinDate ? new Date(employee.joinDate).toISOString().slice(0, 10) : '',
  });
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const submit = async (event) => {
    event.preventDefault(); setError(''); setSaving(true);
    const payload = {
      name: form.name.trim(), email: form.email.trim().toLowerCase(),
      department: form.department.trim() || undefined,
      joinDate: form.joinDate || (editing ? null : undefined),
      ...(editing ? {} : { password: form.password }),
    };
    Object.keys(payload).forEach((key) => payload[key] === undefined && delete payload[key]);
    try {
      const { data } = editing
        ? await api.put(`/employees/${employee.id}`, payload)
        : await api.post('/employees', payload);
      onSaved(data.employee);
    } catch (requestError) { setError(getErrorMessage(requestError)); }
    finally { setSaving(false); }
  };

  return <Modal title={editing ? 'Edit employee' : 'Add employee'} description={editing ? 'Update this employee’s profile details.' : 'Create an employee account. Their role is assigned automatically.'} onClose={onClose}>
    <form onSubmit={submit} className="space-y-4">
      {error && <InlineError message={error} />}
      <Field label="Full name" autoComplete="name" required maxLength={150} value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} placeholder="e.g. Aisha Rao" />
      <Field label="Work email" type="email" autoComplete="email" required maxLength={254} value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} placeholder="aisha@company.com" />
      {!editing && <Field label="Temporary password" type="password" autoComplete="new-password" required minLength={1} value={form.password} onChange={(event) => setForm({ ...form, password: event.target.value })} hint="The employee can use this password to sign in." />}
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Department" value={form.department} onChange={(event) => setForm({ ...form, department: event.target.value })} placeholder="e.g. People" />
        <Field label="Join date" type="date" value={form.joinDate} onChange={(event) => setForm({ ...form, joinDate: event.target.value })} />
      </div>
      <div className="flex justify-end gap-2 border-t border-[#eff0f4] pt-4"><Button type="button" variant="secondary" onClick={onClose}>Cancel</Button><Button type="submit" disabled={saving}>{saving ? 'Saving…' : editing ? 'Save changes' : 'Create employee'}</Button></div>
    </form>
  </Modal>;
}
