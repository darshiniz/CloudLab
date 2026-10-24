import { useId } from 'react';
import useAccent from '../../hooks/useAccent';
import {
  Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Legend, Line, LineChart, Pie, PieChart,
  ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';

// One dark theme for every chart in the app
const tooltipStyle = {
  contentStyle: { background: '#111827', border: '1px solid rgba(255,255,255,.1)', borderRadius: 12, fontSize: 12, color: '#E5E7EB' },
  labelStyle: { color: '#9CA3AF', marginBottom: 4 },
  itemStyle: { color: '#E5E7EB' },
  cursor: { stroke: 'rgba(255,255,255,.15)', fill: 'rgba(255,255,255,.04)' },
};
const axis = { stroke: 'transparent', tickLine: false, axisLine: false };
const grid = <CartesianGrid stroke="rgba(255,255,255,.06)" vertical={false} />;

export function AreaChartX({ data, xKey, yKey, color, height = 240, formatX, formatY, name }) {
  const accent = useAccent();
  color = color ?? accent;
  const id = `g${useId().replace(/:/g, '')}`;
  return (
    <ResponsiveContainer width="100%" height={height}>
      <AreaChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
        <defs>
          <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity={0.35} />
            <stop offset="100%" stopColor={color} stopOpacity={0} />
          </linearGradient>
        </defs>
        {grid}
        <XAxis dataKey={xKey} tickFormatter={formatX} {...axis} minTickGap={16} />
        <YAxis tickFormatter={formatY} {...axis} width={48} />
        <Tooltip {...tooltipStyle} labelFormatter={formatX} formatter={(v) => [formatY ? formatY(v) : v, name ?? yKey]} />
        <Area type="monotone" dataKey={yKey} stroke={color} strokeWidth={2} fill={`url(#${id})`} animationDuration={800} />
      </AreaChart>
    </ResponsiveContainer>
  );
}

export function LineChartX({ data, xKey, lines, height = 240, formatX, formatY, domain }) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <LineChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
        {grid}
        <XAxis dataKey={xKey} tickFormatter={formatX} {...axis} minTickGap={32} />
        <YAxis tickFormatter={formatY} {...axis} width={48} domain={domain} />
        <Tooltip {...tooltipStyle} labelFormatter={formatX} formatter={(v, n) => [formatY ? formatY(v) : v, n]} />
        {lines.length > 1 && <Legend iconType="circle" wrapperStyle={{ fontSize: 12, color: '#9CA3AF' }} />}
        {lines.map((l) => (
          <Line key={l.key} type="monotone" dataKey={l.key} name={l.name} stroke={l.color} strokeWidth={2} dot={false} animationDuration={800} />
        ))}
      </LineChart>
    </ResponsiveContainer>
  );
}

export function BarChartX({ data, xKey, yKey, color, height = 240, layout = 'horizontal', formatY, name, colors }) {
  const accent = useAccent();
  color = color ?? accent;
  const vertical = layout === 'vertical';
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} layout={vertical ? 'vertical' : 'horizontal'} margin={{ top: 8, right: 12, left: vertical ? 8 : 0, bottom: 0 }}>
        <CartesianGrid stroke="rgba(255,255,255,.06)" vertical={vertical} horizontal={!vertical} />
        {vertical ? (
          <>
            <XAxis type="number" {...axis} tickFormatter={formatY} />
            <YAxis type="category" dataKey={xKey} {...axis} width={110} tick={{ fill: '#9CA3AF', fontSize: 12 }} />
          </>
        ) : (
          <>
            <XAxis dataKey={xKey} {...axis} minTickGap={8} />
            <YAxis {...axis} width={48} tickFormatter={formatY} />
          </>
        )}
        <Tooltip {...tooltipStyle} formatter={(v) => [formatY ? formatY(v) : v, name ?? yKey]} />
        <Bar dataKey={yKey} radius={vertical ? [0, 6, 6, 0] : [6, 6, 0, 0]} fill={color} maxBarSize={36} animationDuration={800}>
          {colors && data.map((d, i) => <Cell key={i} fill={colors[i % colors.length]} />)}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

/** data: [{ name, value, color }] */
export function DonutChart({ data, height = 220, centerLabel, centerValue }) {
  const total = data.reduce((s, d) => s + d.value, 0);
  return (
    <div className="flex flex-col items-center gap-4 sm:flex-row">
      <div className="relative w-full max-w-[220px]" style={{ height }}>
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie data={data} dataKey="value" nameKey="name" innerRadius="64%" outerRadius="92%" paddingAngle={2} stroke="none" animationDuration={800}>
              {data.map((d) => <Cell key={d.name} fill={d.color} />)}
            </Pie>
            <Tooltip {...tooltipStyle} />
          </PieChart>
        </ResponsiveContainer>
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-2xl font-bold text-white">{centerValue ?? total}</span>
          {centerLabel && <span className="text-xs text-gray-500">{centerLabel}</span>}
        </div>
      </div>
      <ul className="w-full space-y-2 text-sm">
        {data.map((d) => (
          <li key={d.name} className="flex items-center justify-between gap-3">
            <span className="flex items-center gap-2 text-gray-300"><span className="h-2.5 w-2.5 rounded-full" style={{ background: d.color }} />{d.name}</span>
            <span className="font-mono text-gray-400">{d.value}{total ? <span className="ml-1 text-gray-600">({Math.round((d.value / total) * 100)}%)</span> : null}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
