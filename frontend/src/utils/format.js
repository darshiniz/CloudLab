import { Code2, Coffee, Globe, BarChart3, Cloud } from 'lucide-react';

export const LAB_META = {
  python: { label: 'Python', icon: Code2, color: '#3B82F6' },
  java: { label: 'Java', icon: Coffee, color: '#F97316' },
  web: { label: 'Web Dev', icon: Globe, color: '#14B8A6' },
  datascience: { label: 'Data Science', icon: BarChart3, color: '#8B5CF6' },
  cloud: { label: 'Cloud', icon: Cloud, color: '#06B6D4' },
};
export const labLabel = (t) => LAB_META[t]?.label ?? t;

export function formatBytes(bytes, digits = 1) {
  if (bytes == null) return '—';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0;
  let n = bytes;
  while (n >= 1024 && i < units.length - 1) { n /= 1024; i++; }
  return `${i === 0 ? n : n.toFixed(digits)} ${units[i]}`;
}

export function timeAgo(iso) {
  if (!iso) return '—';
  const diff = (Date.now() - new Date(iso).getTime()) / 1000;
  const future = diff < 0;
  const s = Math.abs(diff);
  const v = s < 60 ? 'just now'
    : s < 3600 ? `${Math.floor(s / 60)} min`
    : s < 86400 ? `${Math.floor(s / 3600)} h`
    : `${Math.floor(s / 86400)} d`;
  if (v === 'just now') return v;
  return future ? `in ${v}` : `${v} ago`;
}

export const minutesUntil = (iso) => (iso ? Math.max(0, Math.ceil((new Date(iso).getTime() - Date.now()) / 60000)) : null);

export function formatDuration(minutes) {
  if (minutes == null) return '—';
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  return h ? `${h}h ${m}m` : `${m}m`;
}

export function uptime(iso) {
  if (!iso) return '—';
  return formatDuration((Date.now() - new Date(iso).getTime()) / 60000);
}

export const formatDate = (iso, opts = { day: 'numeric', month: 'short' }) =>
  iso ? new Date(iso).toLocaleDateString('en-IN', opts) : '—';
export const formatDateTime = (iso) =>
  iso ? new Date(iso).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—';

export const initials = (name = '') => name.replace(/^Dr\.\s*/, '').split(' ').map((p) => p[0]).join('').slice(0, 2).toUpperCase();
export const capitalize = (s = '') => s.charAt(0).toUpperCase() + s.slice(1);
export const cx = (...c) => c.filter(Boolean).join(' ');
