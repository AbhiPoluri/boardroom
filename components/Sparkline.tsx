'use client';

interface SparklineProps {
  data: number[];
  width?: number;
  height?: number;
  color?: string;
}

export function Sparkline({ data, width = 80, height = 20, color = '#34d399' }: SparklineProps) {
  if (!data.length || data.every(d => d === 0)) {
    return (
      <svg width={width} height={height} className="opacity-30">
        <line x1={0} y1={height / 2} x2={width} y2={height / 2} stroke="#3f3f46" strokeWidth={1} strokeDasharray="2 2" />
      </svg>
    );
  }

  const max = Math.max(...data, 1);
  const padding = 1;
  const chartWidth = width - padding * 2;
  const chartHeight = height - padding * 2;

  const points = data.map((value, i) => {
    const x = padding + (i / (data.length - 1)) * chartWidth;
    const y = padding + chartHeight - (value / max) * chartHeight;
    return `${x},${y}`;
  });

  const pathD = points.map((p, i) => (i === 0 ? `M${p}` : `L${p}`)).join(' ');

  // Area fill path
  const firstX = padding;
  const lastX = padding + chartWidth;
  const areaD = `${pathD} L${lastX},${height} L${firstX},${height} Z`;

  return (
    <svg width={width} height={height} className="flex-shrink-0">
      <defs>
        <linearGradient id="sparkFill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity={0.3} />
          <stop offset="100%" stopColor={color} stopOpacity={0} />
        </linearGradient>
      </defs>
      <path d={areaD} fill="url(#sparkFill)" />
      <path d={pathD} fill="none" stroke={color} strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" />
      {/* Current value dot */}
      {data.length > 0 && (
        <circle
          cx={padding + chartWidth}
          cy={padding + chartHeight - (data[data.length - 1] / max) * chartHeight}
          r={2}
          fill={color}
        />
      )}
    </svg>
  );
}
