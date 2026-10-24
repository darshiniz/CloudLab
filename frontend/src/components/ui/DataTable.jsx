import { useMemo, useState } from 'react';
import { ArrowDown, ArrowUp, ArrowUpDown, ChevronLeft, ChevronRight, Search } from 'lucide-react';
import { cx } from '../../utils/format';
import Skeleton from './Skeleton';
import EmptyState from './EmptyState';

/**
 * Sortable, searchable table.
 *  columns: [{ key, header, render?(row), sortValue?(row), sortable?, className?, hideOnMobile? }]
 *  searchKeys: fields (or functions) the search box looks in
 */
export default function DataTable({
  columns, rows = [], loading, searchKeys, searchPlaceholder = 'Search…', toolbar, empty,
  rowClassName, onRowClick, pageSize = 10, initialSort,
}) {
  const [q, setQ] = useState('');
  const [sort, setSort] = useState(initialSort ?? null);
  const [page, setPage] = useState(1);

  const filtered = useMemo(() => {
    let out = rows;
    if (q && searchKeys) {
      const needle = q.toLowerCase();
      out = out.filter((r) => searchKeys.some((k) => String(typeof k === 'function' ? k(r) : r[k] ?? '').toLowerCase().includes(needle)));
    }
    if (sort) {
      const col = columns.find((c) => c.key === sort.key);
      const get = col?.sortValue ?? ((r) => r[sort.key]);
      out = [...out].sort((a, b) => {
        const x = get(a); const y = get(b);
        const cmp = typeof x === 'number' && typeof y === 'number' ? x - y : String(x ?? '').localeCompare(String(y ?? ''));
        return sort.dir === 'asc' ? cmp : -cmp;
      });
    }
    return out;
  }, [rows, q, sort, searchKeys, columns]);

  const pages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const current = Math.min(page, pages);
  const visible = filtered.slice((current - 1) * pageSize, current * pageSize);

  const toggleSort = (key) =>
    setSort((s) => (s?.key !== key ? { key, dir: 'asc' } : s.dir === 'asc' ? { key, dir: 'desc' } : null));

  return (
    <div>
      {(searchKeys || toolbar) && (
        <div className="flex flex-col gap-3 border-b border-line p-4 sm:flex-row sm:items-center sm:justify-between">
          {searchKeys && (
            <div className="relative w-full sm:max-w-xs">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-500" />
              <input
                value={q}
                onChange={(e) => { setQ(e.target.value); setPage(1); }}
                placeholder={searchPlaceholder}
                aria-label={searchPlaceholder}
                className="h-9 w-full rounded-xl border border-line bg-white/[0.03] pl-9 pr-3 text-sm text-white placeholder:text-gray-500 focus:border-accent/60 focus:outline-none"
              />
            </div>
          )}
          {toolbar && <div className="flex flex-wrap items-center gap-2">{toolbar}</div>}
        </div>
      )}
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-line text-left">
              {columns.map((c) => (
                <th key={c.key} className={cx('whitespace-nowrap px-4 py-3 text-xs font-medium uppercase tracking-wider text-gray-500', c.hideOnMobile && 'hidden md:table-cell', c.className)}>
                  {c.sortable === false || !c.header ? c.header : (
                    <button onClick={() => toggleSort(c.key)} className="inline-flex items-center gap-1 hover:text-gray-300">
                      {c.header}
                      {sort?.key === c.key ? (sort.dir === 'asc' ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />) : <ArrowUpDown className="h-3 w-3 opacity-40" />}
                    </button>
                  )}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading
              ? Array.from({ length: 4 }, (_, i) => (
                <tr key={i} className="border-b border-line/60">
                  {columns.map((c) => <td key={c.key} className={cx('px-4 py-3.5', c.hideOnMobile && 'hidden md:table-cell')}><Skeleton className="h-4 w-full max-w-[120px]" /></td>)}
                </tr>
              ))
              : visible.map((r) => (
                <tr
                  key={r.id ?? r.environmentId}
                  onClick={onRowClick ? () => onRowClick(r) : undefined}
                  className={cx('border-b border-line/60 transition-colors last:border-0 hover:bg-white/[0.02]', onRowClick && 'cursor-pointer', rowClassName?.(r))}
                >
                  {columns.map((c) => (
                    <td key={c.key} className={cx('whitespace-nowrap px-4 py-3 text-gray-300', c.hideOnMobile && 'hidden md:table-cell', c.className)}>
                      {c.render ? c.render(r) : r[c.key]}
                    </td>
                  ))}
                </tr>
              ))}
          </tbody>
        </table>
        {!loading && visible.length === 0 && (empty ?? <EmptyState title="Nothing here" message={q ? `No results for “${q}”.` : 'No records yet.'} />)}
      </div>
      {!loading && pages > 1 && (
        <div className="flex items-center justify-between border-t border-line px-4 py-3 text-xs text-gray-500">
          <span>{(current - 1) * pageSize + 1}–{Math.min(current * pageSize, filtered.length)} of {filtered.length}</span>
          <div className="flex gap-1">
            <button disabled={current === 1} onClick={() => setPage(current - 1)} className="rounded-lg p-1.5 hover:bg-white/5 disabled:opacity-30" aria-label="Previous page"><ChevronLeft className="h-4 w-4" /></button>
            <button disabled={current === pages} onClick={() => setPage(current + 1)} className="rounded-lg p-1.5 hover:bg-white/5 disabled:opacity-30" aria-label="Next page"><ChevronRight className="h-4 w-4" /></button>
          </div>
        </div>
      )}
    </div>
  );
}
