import { useEffect, useRef, useState } from 'react';
import { ChevronRight, Download, File, FileCode2, Folder, FolderPlus, HardDrive, Home, Plus, Trash2, Upload } from 'lucide-react';
import { api, saveDownload } from '../../services/api';
import { LAB_TYPE } from '../../constants/enums';
import useQuery from '../../hooks/useQuery';
import useAction from '../../hooks/useAction';
import { useToast } from '../../context/ToastContext';
import { Button, Card, EmptyState, Field, Input, Modal, PageHeader, ResourceBar, Select, Skeleton } from '../../components/ui';
import LabIcon from '../../components/labs/LabIcon';
import { cx, formatBytes, labLabel, timeAgo } from '../../utils/format';

const CODE_EXT = /\.(py|java|js|ts|html|css|ipynb|json|xml|md)$/;

export default function Projects() {
  const toast = useToast();
  const { run, busy } = useAction();
  const projects = useQuery(() => api.listProjects(), []);
  const storage = useQuery(() => api.getStorageUsage(), []);
  const [selected, setSelected] = useState(null);
  const [path, setPath] = useState('/');
  const [typeFilter, setTypeFilter] = useState('all');
  const [newOpen, setNewOpen] = useState(false);
  const [newName, setNewName] = useState('');
  const [newType, setNewType] = useState('python');
  const [confirm, setConfirm] = useState(null);
  const uploadRef = useRef(null);

  const list = projects.data?.data ?? [];
  const shown = list.filter((p) => typeFilter === 'all' || p.labType === typeFilter);
  const project = list.find((p) => p.id === selected) ?? shown[0];
  const files = useQuery(() => (project ? api.listFiles(project.id, path) : Promise.resolve(null)), [project?.id, path]);

  useEffect(() => { setPath('/'); }, [project?.id]);

  const refreshAll = async () => { await Promise.all([files.refresh(), storage.refresh(), projects.refresh()]); };
  const upload = (file) => run('upload', () => api.uploadFile(project.id, file, path), { success: (f) => `Uploaded ${f.name}`, after: refreshAll });
  const download = (f) => run(`dl:${f.path}`, async () => saveDownload(await api.downloadFile(project.id, f.path)));
  const createProject = async (e) => {
    e.preventDefault();
    const p = await run('create', () => api.createProject(newName.trim(), newType), { success: 'Project created', after: projects.refresh });
    if (p) { setSelected(p.id); setNewOpen(false); setNewName(''); }
  };

  const crumbs = path.split('/').filter(Boolean);
  const st = storage.data;
  const items = files.data?.data ?? [];

  return (
    <>
      <PageHeader title="Projects & Files" description="Your files live on persistent storage and survive when a lab is deleted." actions={<Button icon={FolderPlus} onClick={() => setNewOpen(true)}>New project</Button>} />

      <div className="grid gap-6 lg:grid-cols-[280px_1fr]">
        <div className="space-y-6">
          <Card title="Storage" action={<HardDrive className="h-4 w-4 text-gray-500" />}>
            {st ? (
              <>
                <ResourceBar value={st.usedBytes} max={st.limitBytes} display={`${formatBytes(st.usedBytes)} / ${formatBytes(st.limitBytes, 0)}`} />
                <p className="mt-2 text-xs text-gray-500">{formatBytes(st.limitBytes - st.usedBytes)} free</p>
              </>
            ) : <Skeleton className="h-8" />}
          </Card>
          <Card title="Projects" padded={false} action={
            <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)} aria-label="Filter by lab type" className="rounded-lg border border-line bg-transparent px-2 py-1 text-xs text-gray-300">
              <option value="all">All labs</option>
              {['python', 'java', 'web'].map((t) => <option key={t} value={t}>{labLabel(t)}</option>)}
            </select>
          }>
            {projects.loading ? <div className="space-y-2 p-4">{[1, 2, 3].map((i) => <Skeleton key={i} className="h-12" />)}</div> : (
              <ul className="p-2">
                {shown.map((p) => (
                  <li key={p.id}>
                    <button onClick={() => setSelected(p.id)} className={cx('flex w-full items-center gap-3 rounded-xl p-2.5 text-left transition', project?.id === p.id ? 'bg-accent/10 ring-1 ring-inset ring-accent/25' : 'hover:bg-white/[0.03]')}>
                      <LabIcon type={p.labType} size="sm" />
                      <span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium text-white">{p.name}</span><span className="text-xs text-gray-500">{labLabel(p.labType)} · {timeAgo(p.modifiedAt)}</span></span>
                    </button>
                  </li>
                ))}
                {!shown.length && <p className="p-4 text-sm text-gray-500">No projects for this lab type.</p>}
              </ul>
            )}
          </Card>
        </div>

        <Card padded={false} title={project?.name ?? 'Files'} subtitle={project ? `${labLabel(project.labType)} project · ${project.id}` : undefined} action={project && (
          <div className="flex gap-2">
            <Button size="sm" icon={Upload} loading={busy === 'upload'} onClick={() => uploadRef.current?.click()}>Upload</Button>
            <Button size="sm" variant="danger" icon={Trash2} onClick={() => setConfirm({ type: 'project', project })}>Delete project</Button>
            <input ref={uploadRef} type="file" className="hidden" onChange={(e) => { if (e.target.files[0]) upload(e.target.files[0]); e.target.value = ''; }} />
          </div>
        )}>
          {!project ? (
            <EmptyState icon={Folder} title="No projects yet" message="Create a project to keep your code and files." action={<Button icon={Plus} onClick={() => setNewOpen(true)}>New project</Button>} />
          ) : (
            <>
              <nav className="flex flex-wrap items-center gap-1 border-b border-line px-5 py-3 text-sm" aria-label="Breadcrumb">
                <button onClick={() => setPath('/')} className="flex items-center gap-1 text-gray-400 hover:text-white"><Home className="h-3.5 w-3.5" />root</button>
                {crumbs.map((c, i) => (
                  <span key={c} className="flex items-center gap-1"><ChevronRight className="h-3.5 w-3.5 text-gray-600" />
                    <button onClick={() => setPath('/' + crumbs.slice(0, i + 1).join('/'))} className="text-gray-300 hover:text-white">{c}</button>
                  </span>
                ))}
              </nav>
              <div
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => { e.preventDefault(); if (e.dataTransfer.files[0]) upload(e.dataTransfer.files[0]); }}
              >
                {files.loading ? <div className="space-y-2 p-5">{[1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-10" />)}</div> : items.length === 0 ? (
                  <EmptyState icon={Upload} title="Empty folder" message="Drag a file here or use Upload." />
                ) : (
                  <ul className="divide-y divide-line/60">
                    {items.map((f) => (
                      <li key={f.path} className="group flex items-center gap-3 px-5 py-3 hover:bg-white/[0.02]">
                        {f.type === 'folder' ? <Folder className="h-5 w-5 text-accent" /> : CODE_EXT.test(f.name) ? <FileCode2 className="h-5 w-5 text-gray-400" /> : <File className="h-5 w-5 text-gray-400" />}
                        {f.type === 'folder' ? (
                          <button onClick={() => setPath(f.path)} className="flex-1 truncate text-left text-sm font-medium text-white hover:underline">{f.name}</button>
                        ) : <span className="flex-1 truncate text-sm text-gray-200">{f.name}</span>}
                        <span className="hidden w-20 text-right font-mono text-xs text-gray-500 sm:block">{f.type === 'file' ? formatBytes(f.sizeBytes) : '—'}</span>
                        <span className="hidden w-24 text-right text-xs text-gray-500 md:block">{timeAgo(f.modifiedAt)}</span>
                        <div className="flex gap-1 opacity-100 sm:opacity-0 sm:transition sm:group-hover:opacity-100">
                          {f.type === 'file' && <button onClick={() => download(f)} className="rounded-lg p-1.5 text-gray-400 hover:bg-white/5 hover:text-white" aria-label={`Download ${f.name}`}><Download className="h-4 w-4" /></button>}
                          <button onClick={() => setConfirm({ type: 'file', file: f })} className="rounded-lg p-1.5 text-gray-400 hover:bg-red-500/10 hover:text-red-300" aria-label={`Delete ${f.name}`}><Trash2 className="h-4 w-4" /></button>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </>
          )}
        </Card>
      </div>

      <Modal open={newOpen} onClose={() => setNewOpen(false)} size="sm" title="New project"
        footer={<><Button variant="secondary" onClick={() => setNewOpen(false)}>Cancel</Button><Button type="submit" form="new-project" loading={busy === 'create'}>Create</Button></>}>
        <form id="new-project" onSubmit={createProject} className="space-y-4">
          <Field label="Project name" htmlFor="pname" hint="3 to 40 characters"><Input id="pname" value={newName} onChange={(e) => setNewName(e.target.value)} autoFocus /></Field>
          <Field label="Lab type" htmlFor="ptype">
            <Select id="ptype" value={newType} onChange={(e) => setNewType(e.target.value)}>{[LAB_TYPE.PYTHON, LAB_TYPE.JAVA, LAB_TYPE.WEB].map((t) => <option key={t} value={t}>{labLabel(t)}</option>)}</Select>
          </Field>
        </form>
      </Modal>

      <Modal open={!!confirm} onClose={() => setConfirm(null)} size="sm" title={confirm?.type === 'project' ? 'Delete project?' : 'Delete file?'}
        footer={<><Button variant="secondary" onClick={() => setConfirm(null)}>Cancel</Button><Button variant="danger" loading={busy === 'del'} onClick={async () => {
          if (confirm.type === 'project') {
            await run('del', () => api.deleteProject(confirm.project.id), { success: 'Project deleted', after: async () => { setSelected(null); await projects.refresh(); await storage.refresh(); } });
          } else {
            await run('del', () => api.deleteFile(project.id, confirm.file.path), { success: `${confirm.file.name} deleted`, after: refreshAll });
          }
          setConfirm(null);
        }}>Delete</Button></>}>
        <p className="text-sm text-gray-300">{confirm?.type === 'project' ? <>All files in <strong className="text-white">{confirm.project.name}</strong> will be removed. This can't be undone.</> : <><strong className="text-white">{confirm?.file?.path}</strong> will be removed{confirm?.file?.type === 'folder' ? ' with everything inside it' : ''}.</>}</p>
      </Modal>
    </>
  );
}
