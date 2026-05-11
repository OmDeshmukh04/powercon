import Chart from 'chart.js/auto';
import { useEffect, useRef } from 'react';

export default function CapSurgeChart({ data, labels, title }: { data: number[], labels: string[], title: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (!canvasRef.current) return;
    const chart = new Chart(canvasRef.current, {
      type: 'bar',
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
