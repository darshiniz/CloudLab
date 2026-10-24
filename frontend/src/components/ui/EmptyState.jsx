import { Inbox } from 'lucide-react';

export default function EmptyState({ icon: Icon = Inbox, title, message, action }) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-12 text-center">
      <div className="mb-4 rounded-2xl bg-accent/10 p-4 text-accent ring-1 ring-inset ring-accent/20">
        <Icon className="h-7 w-7" />
      </div>
      {title && <h4 className="text-base font-semibold text-white">{title}</h4>}
      {message && <p className="mt-1 max-w-sm text-sm text-gray-400">{message}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}
