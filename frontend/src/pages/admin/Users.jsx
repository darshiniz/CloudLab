import { useState } from 'react';
import { Check, UserPlus, X } from 'lucide-react';
import { api } from '../../services/api';
import { ROLE } from '../../constants/enums';
import { useAuth } from '../../context/AuthContext';
import useQuery from '../../hooks/useQuery';
import useAction from '../../hooks/useAction';
import { useToast } from '../../context/ToastContext';
import { Avatar, Button, Card, DataTable, Field, Input, Modal, Mono, PageHeader, RoleBadge, Select, StatusBadge, Toggle } from '../../components/ui';
import { capitalize, formatDateTime, timeAgo } from '../../utils/format';

const EMPTY = { name: '', email: '', role: 'student', password: '', rollNo: '' };

export default function Users() {
  const { user: me } = useAuth();
  const toast = useToast();
  const { run, busy } = useAction();
  const [role, setRole] = useState('');
  const users = useQuery(() => api.listUsers({ role: role || undefined, pageSize: 100 }), [role]);
  const [addOpen, setAddOpen] = useState(false);
  const [form, setForm] = useState(EMPTY);
  const [errors, setErrors] = useState({});
  const [saving, setSaving] = useState(false);
  const rows = users.data?.data ?? [];
  const pending = rows.filter((u) => u.status === 'pending');

  const patch = (u, changes, msg) => run(`${u.id}:patch`, () => api.updateUser(u.id, changes), { success: msg, after: users.refresh });

  const submit = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      const created = await api.createUser({ ...form, rollNo: form.role === 'student' ? form.rollNo : null });
      toast.success(`${created.name} added`);
      setAddOpen(false); setForm(EMPTY); setErrors({});
      users.refresh();
    } catch (err) {
      setErrors(err.code === 'EMAIL_EXISTS' ? { email: err.message } : err.details ?? {});
      toast.apiError(err);
    } finally { setSaving(false); }
  };

  const columns = [
    { key: 'name', header: 'User', render: (u) => <div className="flex items-center gap-3"><Avatar name={u.name} size="sm" /><div><p className="font-medium text-white">{u.name}{u.id === me.id && <span className="ml-2 text-xs text-gray-500">(you)</span>}</p><p className="text-xs text-gray-500">{u.email}</p></div></div> },
    { key: 'role', header: 'Role', render: (u) => <RoleBadge role={u.role} /> },
    { key: 'rollNo', header: 'Roll no', render: (u) => <Mono>{u.rollNo ?? '—'}</Mono>, hideOnMobile: true },
    { key: 'lastActiveAt', header: 'Last active', render: (u) => timeAgo(u.lastActiveAt), hideOnMobile: true },
    { key: 'status', header: 'Status', render: (u) => (
      <div className="flex items-center gap-3">
        {['active', 'inactive'].includes(u.status) && (
          <Toggle checked={u.status === 'active'} label={`${u.name} active`} disabled={u.id === me.id || busy === `${u.id}:patch`}
            onChange={(on) => patch(u, { status: on ? 'active' : 'inactive' }, on ? `${u.name} activated` : `${u.name} deactivated`)} />
        )}
        <div>
          <StatusBadge status={u.status} />
          {u.approvedBy && <p className="mt-0.5 text-[11px] text-gray-600">Approved by {u.approvedBy}</p>}
        </div>
      </div>
    ) },
    { key: 'change', header: 'Change role', sortable: false, render: (u) => (
      <Select aria-label={`Change role for ${u.name}`} value={u.role} disabled={u.id === me.id} className="h-8 w-32 text-xs"
        onChange={(e) => patch(u, { role: e.target.value }, `${u.name} is now ${e.target.value}`)}>
        {Object.values(ROLE).map((r) => <option key={r} value={r}>{capitalize(r)}</option>)}
      </Select>
    ) },
  ];

  const count = (r) => (users.data?.data ?? []).filter((u) => u.role === r).length;
  return (
    <>
      <PageHeader title="User Management" description="Students can register themselves; their accounts stay Pending until you approve them. You can also add users directly." actions={<Button icon={UserPlus} onClick={() => setAddOpen(true)}>Add user</Button>} />
      {pending.length > 0 && (
        <Card title="Waiting for approval" subtitle={`${pending.length} new registration${pending.length > 1 ? 's' : ''}`} className="mb-6">
          <ul className="divide-y divide-line">
            {pending.map((u) => (
              <li key={u.id} className="flex flex-wrap items-center gap-3 py-3">
                <Avatar name={u.name} size="sm" />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-white">{u.name} <span className="ml-1 font-mono text-xs text-gray-600">{u.rollNo}</span></p>
                  <p className="text-xs text-gray-500">{u.email} · registered {formatDateTime(u.createdAt)}</p>
                </div>
                <Button size="sm" icon={Check} loading={busy === `${u.id}:patch`} onClick={() => patch(u, { status: 'active' }, `${u.name} approved`)}>Approve</Button>
                <Button size="sm" variant="secondary" icon={X} disabled={busy === `${u.id}:patch`} onClick={() => patch(u, { status: 'rejected' }, `${u.name} rejected`)}>Reject</Button>
              </li>
            ))}
          </ul>
        </Card>
      )}
      <Card padded={false}>
        <DataTable columns={columns} rows={rows} loading={users.loading} searchKeys={['name', 'email', 'rollNo']} searchPlaceholder="Search name, email, roll no…" pageSize={12}
          toolbar={<Select value={role} onChange={(e) => setRole(e.target.value)} aria-label="Filter by role" className="h-9 w-40">
            <option value="">All roles</option>{Object.values(ROLE).map((r) => <option key={r} value={r}>{capitalize(r)}s{!role ? ` (${count(r)})` : ''}</option>)}
          </Select>} />
      </Card>

      <Modal open={addOpen} onClose={() => setAddOpen(false)} title="Add user" description="They can log in straight away with this password."
        footer={<><Button variant="secondary" onClick={() => setAddOpen(false)}>Cancel</Button><Button type="submit" form="add-user" loading={saving}>Add user</Button></>}>
        <form id="add-user" onSubmit={submit} className="grid gap-4 sm:grid-cols-2" noValidate>
          <Field label="Full name" htmlFor="u-name" error={errors.name} className="sm:col-span-2"><Input id="u-name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} invalid={!!errors.name} /></Field>
          <Field label="Email" htmlFor="u-email" error={errors.email} className="sm:col-span-2"><Input id="u-email" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} invalid={!!errors.email} placeholder="name@gbs.edu" /></Field>
          <Field label="Role" htmlFor="u-role" error={errors.role}>
            <Select id="u-role" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>{Object.values(ROLE).map((r) => <option key={r} value={r}>{capitalize(r)}</option>)}</Select>
          </Field>
          <Field label="Roll no" htmlFor="u-roll" error={errors.rollNo} hint={form.role === 'student' ? 'Required for students' : 'Only for students'}>
            <Input id="u-roll" value={form.rollNo} disabled={form.role !== 'student'} onChange={(e) => setForm({ ...form, rollNo: e.target.value })} invalid={!!errors.rollNo} placeholder="25P0320023" />
          </Field>
          <Field label="Temporary password" htmlFor="u-pass" error={errors.password} hint="At least 8 characters" className="sm:col-span-2"><Input id="u-pass" type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} invalid={!!errors.password} /></Field>
        </form>
      </Modal>
    </>
  );
}
