'use client';

import { ComposedChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';

interface MonthlyGgr {
  mes: string;
  ggr_total: number;
  qtd_usuarios_ativos: number;
}

interface MonthlyGgrChartProps {
  data: MonthlyGgr[];
  loading: boolean;
  tabColor: string;
}

const TOTAL_MONTHS = 20;

const formatMesLabel = (mes: string) => {
  const [year, month] = mes.split('-');
  const meses = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];
  return `${meses[parseInt(month) - 1]}/${year.slice(2)}`;
};

const formatCurrency = (value: number) =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(value);

const formatInteger = (value: number) =>
  new Intl.NumberFormat('pt-BR').format(value);

function padTo20Months(data: MonthlyGgr[]): MonthlyGgr[] {
  if (!data || data.length === 0) {
    const now = new Date();
    const months: string[] = [];
    for (let i = 0; i < TOTAL_MONTHS; i++) {
      const d = new Date(now.getFullYear(), now.getMonth() + i, 1);
      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, '0');
      months.push(`${y}-${m}`);
    }
    return months.map(mes => ({ mes, ggr_total: 0, qtd_usuarios_ativos: 0 }));
  }

  const sorted = [...data].sort((a, b) => a.mes.localeCompare(b.mes));
  const [startYear, startMonth] = sorted[0].mes.split('-').map(Number);

  const months: string[] = [];
  for (let i = 0; i < TOTAL_MONTHS; i++) {
    const d = new Date(startYear, startMonth - 1 + i, 1);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    months.push(`${y}-${m}`);
  }

  const dataMap = new Map(data.map(d => [d.mes, d]));

  return months.map(mes => {
    const d = dataMap.get(mes) ?? { mes, ggr_total: 0, qtd_usuarios_ativos: 0 };
    return { ...d, ggr_total: Math.max(0, d.ggr_total) };
  });
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const CustomTooltip = ({ active, payload, label }: any) => {
  if (!active || !payload?.length) return null;
  return (
    <div style={{
      background: 'rgba(10, 14, 26, 0.95)',
      border: '1px solid rgba(34, 211, 238, 0.3)',
      borderRadius: '8px',
      padding: '12px 16px',
      fontSize: '0.85rem',
    }}>
      <p style={{ color: '#22d3ee', fontWeight: 600, marginBottom: '6px' }}>{formatMesLabel(label)}</p>
      {payload.map((entry: { color: string; name: string; value: number }, i: number) => (
        <p key={i} style={{ color: entry.color, margin: '2px 0' }}>
          {entry.name}: {entry.name === 'GGR' ? formatCurrency(entry.value) : formatInteger(entry.value)}
        </p>
      ))}
    </div>
  );
};

export function MonthlyGgrChart({ data, loading, tabColor }: MonthlyGgrChartProps) {
  if (loading) {
    return (
      <div style={{
        background: 'rgba(255, 255, 255, 0.03)',
        border: '1px solid rgba(255, 255, 255, 0.1)',
        borderRadius: '12px',
        padding: '40px',
        textAlign: 'center',
        color: 'rgba(255, 255, 255, 0.5)',
      }}>
        Carregando dados de GGR...
      </div>
    );
  }

  const chartData = padTo20Months(data || []);

  return (
    <div style={{
      background: 'rgba(255, 255, 255, 0.03)',
      border: '1px solid rgba(255, 255, 255, 0.1)',
      borderRadius: '12px',
      padding: '24px',
    }}>
      <h3 style={{
        color: '#34d399',
        fontSize: '1.1rem',
        fontWeight: 600,
        marginTop: 0,
        marginBottom: '20px',
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
      }}>
        GGR Mensal
      </h3>

      <ResponsiveContainer width="100%" height={360}>
        <ComposedChart data={chartData} margin={{ top: 5, right: 20, left: 10, bottom: 5 }}
          barCategoryGap="20%" barGap={4}
        >
          <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
          <XAxis
            dataKey="mes"
            interval={0}
            height={80}
            tickLine={false}
            axisLine={{ stroke: 'rgba(255,255,255,0.1)' }}
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            tick={(props: any) => {
              const { x, y, payload } = props;
              return (
                <g transform={`translate(${x},${y + 8})`}>
                  <text
                    x={0} y={0}
                    textAnchor="end"
                    transform="rotate(-90)"
                    fill="rgba(255,255,255,0.5)"
                    fontSize={10}
                  >
                    {formatMesLabel(payload.value)}
                  </text>
                </g>
              );
            }}
          />
          {/* Eixo esquerdo - GGR (R$) */}
          <YAxis
            yAxisId="ggr"
            orientation="left"
            tickFormatter={(v) => `${(v / 1000).toFixed(0)}k`}
            tick={{ fill: '#34d399', fontSize: 12 }}
            label={{
              value: 'GGR (R$)',
              angle: -90,
              position: 'insideLeft',
              offset: 0,
              style: { fill: '#34d399', fontSize: 12 },
            }}
          />
          {/* Eixo direito - Usuarios Ativos */}
          <YAxis
            yAxisId="usuarios"
            orientation="right"
            tick={{ fill: '#818cf8', fontSize: 12 }}
            allowDecimals={false}
            label={{
              value: 'Usuarios Ativos',
              angle: 90,
              position: 'insideRight',
              offset: 0,
              style: { fill: '#818cf8', fontSize: 12 },
            }}
          />
          <Tooltip content={<CustomTooltip />} />
          <Bar
            yAxisId="ggr"
            dataKey="ggr_total"
            name="GGR"
            fill="#34d399"
            radius={[4, 4, 0, 0]}
            fillOpacity={0.85}
            maxBarSize={32}
          />
          <Bar
            yAxisId="usuarios"
            dataKey="qtd_usuarios_ativos"
            name="Usuarios Ativos"
            fill="#818cf8"
            radius={[4, 4, 0, 0]}
            fillOpacity={0.85}
            maxBarSize={32}
          />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}
