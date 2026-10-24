import { api } from '../../services/api';
import useQuery from '../../hooks/useQuery';
import { PageHeader, SkeletonCards, Stagger } from '../../components/ui';
import LabCard from '../../components/labs/LabCard';

export default function FacultyTemplates() {
  const { data, loading } = useQuery(() => api.listLabs(), []);
  return (
    <>
      <PageHeader title="Lab Templates" description="What's included in each lab your students can launch. Read-only: admins manage templates." />
      {loading ? <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3"><SkeletonCards count={5} className="h-72" /></div> : (
        <Stagger className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
          {data.data.map((l) => <LabCard key={l.id} lab={l} action={<p className="border-t border-line pt-3 font-mono text-xs text-gray-500">{l.dockerImage}</p>} />)}
        </Stagger>
      )}
    </>
  );
}
