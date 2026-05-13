import Chart from 'chart.js/auto';
import { useEffect, useRef } from 'react';

function formatValue(value: unknown) {
  const num = typeof value === 'number' ? value : Number(value ?? 0);
  return Number.isFinite(num) ? num.toLocaleString() : '';
}

const valueLabelPlugin = {
  id: 'value-labels',
  afterDatasetsDraw(chart: Chart) {
    const { ctx } = chart;
    ctx.save();
    ctx.fillStyle = '#1a2332';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';
    ctx.font = '700 12px sans-serif';

    chart.getSortedVisibleDatasetMetas().forEach((meta) => {
      if (meta.type !== 'bar') return;
      meta.data.forEach((bar: any, index: number) => {
        const rawValue = chart.data.datasets[meta.index]?.data?.[index];
        const label = formatValue(rawValue);
        if (!label) return;
        const x = bar.x;
        const y = Math.min(bar.y, bar.base) - 4;
        ctx.fillText(label, x, y);
      });
    });

    ctx.restore();
  },
};

export default function CapSurgeChart({ data, labels, title }: { data: number[], labels: string[], title: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (!canvasRef.current) return;
    const chart = new Chart(canvasRef.current, {
      type: 'bar',
      plugins: [valueLabelPlugin],
      data: {
        labels,
        datasets: [
          {
            label: title,
            data,
            backgroundColor: 'rgba(45,127,193,0.7)',
            borderRadius: 8,
          },
        ],
      },
      options: {
        responsive: true,
        animation: false,
        plugins: {
          legend: { display: false },
          title: { display: !!title, text: title },
        },
        scales: {
          x: { grid: { display: false } },
          y: { beginAtZero: true },
        },
      },
    });
    return () => chart.destroy();
  }, [data, labels, title]);

  return <canvas ref={canvasRef} style={{ width: '100%', maxHeight: 220 }} />;
}
