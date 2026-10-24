import { useState } from 'react';
import { Database, HardDriveDownload, Info, Trash2 } from 'lucide-react';
import { api } from '../../services/api';
import { ENV_STATUS } from '../../constants/enums';
import useQuery from '../../hooks/useQuery';
import useAction from '../../hooks/useAction';
import { Banner, Button, Card, DataTable, Dropzone, EmptyState, Field, Input, Modal, Mono, PageHeader, Select, Tabs } from '../../components/ui';
import { formatBytes, formatDate } from '../../utils/format';

export default function Datasets() {
  const [tab, setTab] = useState('shared');
  const { run, busy } = useAction();
  const shared = useQuery(() => api.listDatasets('shared'), []);
  const mine = useQuery(() => api.listDatasets('mine'), []);
  const envs = useQuery(() => api.listEnvironments({ status: 'running,inactive' }), []);
  const [mount, setMount] = useState(null);
  const [envId, setEnvId] = useState('');
  const [pending, setPending] = useState(null);
  const [desc, setDesc] = useState('');
  const running = envs.data?.data ?? [];

  const openMount = (ds) => { setMount(ds); setEnvId(running[0]?.id ?? ''); };
  const doMount = async () => {
    const r = await run('mount', () => api.mountDataset(envId, mount.id), { success: (res) => `Mounted at ${res.mountPath}` });
    if (r) setMount(null);
  };
  const upload = async () => {
    const r = await run('upload', () => api.uploadDataset({ file: pending, name: pending.name, description: desc, scope: 'mine' }), { success: (d) => `${d.name} uploaded`, after: mine.refresh });
    if (r) { setPending(null); setDesc(''); }
  };

  const base = [
    { key: 'name', header: 'Dataset', render: (d) => <div><p className="font-medium text-white">{d.name}</p><p className="text-xs text-gray-500">{d.description}</p></div> },
    { key: 'sizeBytes', header: 'Size', render: (d) => <Mono>{formatBytes(d.sizeBytes)}</Mono> },
    { key: 'rows', header: 'Rows', render: (d) => <Mono>{d.rows?.toLocaleString('en-IN') ?? '—'}</Mono>, hideOnMobile: true },
    { key: 'mountPath', header: 'Path in lab', render: (d) => <Mono className="text-gray-500">{d.mountPath}</Mono>, hideOnMobile: true },
  ];
  const sharedCols = [...base, { key: 'a', header: '', sortable: false, render: (d) => <div className="text-right"><Button size="sm" icon={HardDriveDownload} onClick={() => openMount(d)}>Mount in lab</Button></div> }];
  const mineCols = [...base, { key: 'uploadedAt', header: 'Uploaded', render: (d) => formatDate(d.uploadedAt), hideOnMobile: true },
    { key: 'a', header: '', sortable: false, render: (d) => (
      <div className="flex justify-end gap-1.5">
        <Button size="sm" variant="secondary" onClick={() => openMount(d)}>Mount</Button>
        <Button size="sm" variant="danger" icon={Trash2} loading={busy === `del:${d.id}`} onClick={() => run(`del:${d.id}`, () => api.deleteDataset(d.id), { success: 'Dataset deleted', after: mine.refresh })} aria-label={`Delete ${d.name}`} />
      </div>
    ) }];

  return (
    <>
      <PageHeader title="Datasets" description="Shared course datasets and your own uploads." />
      <Banner tone="info" className="mb-6">Datasets are mounted at <Mono className="text-blue-200">/data</Mono> inside your lab: shared ones at <Mono className="text-blue-200">/data/shared</Mono> (read-only), yours at <Mono className="text-blue-200">/data/mine</Mono>.</Banner>

      <Tabs className="mb-5" value={tab} onChange={setTab} tabs={[{ value: 'shared', label: 'Shared datasets', count: shared.data?.meta?.total }, { value: 'mine', label: 'My datasets', count: mine.data?.meta?.total }]} />

      {tab === 'shared' ? (
        <Card padded={false}><DataTable columns={sharedCols} rows={shared.data?.data ?? []} loading={shared.loading} searchKeys={['name', 'description']} searchPlaceholder="Search datasets…" /></Card>
      ) : (
        <div className="grid gap-6 lg:grid-cols-[320px_1fr]">
          <Card title="Upload a dataset">
            {pending ? (
              <div className="space-y-4">
                <div className="rounded-xl border border-line bg-white/[0.02] p-3"><p className="truncate text-sm text-white">{pending.name}</p><p className="font-mono text-xs text-gray-500">{formatBytes(pending.size)}</p></div>
                <Field label="Description" htmlFor="dsdesc"><Input id="dsdesc" value={desc} onChange={(e) => setDesc(e.target.value)} placeholder="What's in this file?" /></Field>
                <div className="flex gap-2"><Button variant="secondary" onClick={() => setPending(null)}>Cancel</Button><Button className="flex-1" loading={busy === 'upload'} onClick={upload}>Upload</Button></div>
              </div>
            ) : <Dropzone onFile={setPending} accept=".csv,.json,.txt,.xlsx" hint="CSV, JSON or TXT · counts toward your 5 GB" />}
          </Card>
          <Card padded={false}>
            <DataTable columns={mineCols} rows={mine.data?.data ?? []} loading={mine.loading} empty={<EmptyState icon={Database} title="No datasets yet" message="Upload a CSV to use it in any of your labs." />} />
          </Card>
        </div>
      )}

      <Modal open={!!mount} onClose={() => setMount(null)} size="sm" title={`Mount ${mount?.name ?? ''}`} description="Pick a running lab."
        footer={<><Button variant="secondary" onClick={() => setMount(null)}>Cancel</Button><Button disabled={!envId} loading={busy === 'mount'} onClick={doMount}>Mount</Button></>}>
        {running.length ? (
          <Field label="Lab" htmlFor="mountenv" hint={mount && `Will appear at ${mount.mountPath}`}>
            <Select id="mountenv" value={envId} onChange={(e) => setEnvId(e.target.value)}>
              {running.map((e) => <option key={e.id} value={e.id}>{e.name} ({e.status === ENV_STATUS.INACTIVE ? 'inactive' : 'running'})</option>)}
            </Select>
          </Field>
        ) : <p className="flex items-center gap-2 text-sm text-gray-400"><Info className="h-4 w-4" />Start a lab first, then mount the dataset into it.</p>}
      </Modal>
    </>
  );
}
