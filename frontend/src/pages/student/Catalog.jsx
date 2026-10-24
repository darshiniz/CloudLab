import { useState } from 'react';
import { api } from '../../services/api';
import useQuery from '../../hooks/useQuery';
import { PageHeader, SkeletonCards, Stagger, Banner } from '../../components/ui';
import LabCard from '../../components/labs/LabCard';
import CreateLabModal from '../../components/labs/CreateLabModal';

export default function Catalog() {
  const { data, loading } = useQuery(() => api.listLabs(), []);
  const [selected, setSelected] = useState(null);
  const labs = data?.data ?? [];

  return (
    <>
      <PageHeader title="Lab Catalog" description="Pre-configured environments. Each lab runs in its own isolated Docker container." />
      <Banner tone="info" className="mb-6">Small labs get 1 vCPU / 1 GB, Standard labs 2 vCPU / 2 GB. Every lab has 5 GB of persistent storage.</Banner>
      {loading ? (
        <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3"><SkeletonCards count={5} className="h-80" /></div>
      ) : (
        <Stagger className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
          {labs.map((l) => <LabCard key={l.id} lab={l} onCreate={setSelected} />)}
        </Stagger>
      )}
      <CreateLabModal open={!!selected} onClose={() => setSelected(null)} labs={labs} initialLab={selected} />
    </>
  );
}
