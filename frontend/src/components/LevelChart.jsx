import { useMemo } from 'react';
import {
  ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid
} from 'recharts';

/**
 * Time-series line chart of river gauge readings (#92).
 *
 * @param {Array} readings - [{ reading_time, gage_height_ft, discharge_cfs }]
 * @param {'discharge_cfs'|'gage_height_ft'} metric - which series to plot
 */
const METRIC_META = {
  discharge_cfs: { label: 'Discharge (cfs)', color: '#1e6fb8', unit: 'cfs' },
  gage_height_ft: { label: 'Gage height (ft)', color: '#2e8b57', unit: 'ft' }
};

function LevelChart({ readings, metric }) {
  const meta = METRIC_META[metric] || METRIC_META.discharge_cfs;

  const data = useMemo(() => (readings || [])
    .filter(r => r[metric] != null)
    .map(r => ({ t: new Date(r.reading_time).getTime(), value: Number(r[metric]) })),
  [readings, metric]);

  if (data.length === 0) {
    return <p className="river-levels-empty">No {meta.label.toLowerCase()} data for this window.</p>;
  }

  const fmtTime = (t) => new Date(t).toLocaleDateString(undefined, { month: 'numeric', day: 'numeric' });
  const fmtTooltip = (t) => new Date(t).toLocaleString(undefined, {
    month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit'
  });

  return (
    <ResponsiveContainer width="100%" height={160}>
      <LineChart data={data} margin={{ top: 8, right: 40, bottom: 4, left: 28 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#e0e0e0" />
        <XAxis
          dataKey="t"
          type="number"
          scale="time"
          domain={['dataMin', 'dataMax']}
          tickFormatter={fmtTime}
          fontSize={11}
          minTickGap={32}
        />
        <YAxis fontSize={11} width={40} domain={['auto', 'auto']} />
        <Tooltip
          labelFormatter={fmtTooltip}
          formatter={(value) => [`${value} ${meta.unit}`, meta.label]}
        />
        <Line
          type="monotone"
          dataKey="value"
          name={meta.label}
          stroke={meta.color}
          strokeWidth={2}
          dot={false}
          isAnimationActive={false}
        />
      </LineChart>
    </ResponsiveContainer>
  );
}

export default LevelChart;
