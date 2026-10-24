import { Link } from 'react-router-dom';
import { Compass } from 'lucide-react';
import { Button } from '../../components/ui';

export default function NotFound() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-bg px-4 text-center">
      <div className="glow-radial pointer-events-none absolute inset-0" />
      <Compass className="relative h-12 w-12 text-brand-from" />
      <h1 className="relative mt-4 text-4xl font-bold">Page not found</h1>
      <p className="relative mt-2 text-gray-400">This page doesn't exist or you don't have access to it.</p>
      <Button as={Link} to="/" className="relative mt-6">Back to home</Button>
    </div>
  );
}
