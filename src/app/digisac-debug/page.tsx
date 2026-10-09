'use client';

import { useState } from 'react';

export default function DigisacDebugPage() {
  const [logs, setLogs] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [summary, setSummary] = useState<any>(null);

  const runTest = async () => {
    setLoading(true);
    setLogs([]);
    setSummary(null);

    try {
      const res = await fetch('/api/digisac/debug');
      const data = await res.json();
      
      setLogs(data.logs || []);
      setSummary(data.summary || null);
    } catch (error) {
      setLogs([
        '❌ ERRO AO EXECUTAR TESTE',
        error instanceof Error ? error.message : String(error)
      ]);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{
      minHeight: '100vh',
      background: 'linear-gradient(135deg, #0a0e1a 0%, #1a1f3a 100%)',
      color: '#fff',
      padding: '40px 20px'
    }}>
      <div style={{
        maxWidth: '1000px',
        margin: '0 auto'
      }}>
        <h1 style={{
          fontSize: '2rem',
          marginBottom: '10px',
          color: '#22d3ee',
          display: 'flex',
          alignItems: 'center',
          gap: '12px'
        }}>
          🔧 Diagnóstico Digisac API
        </h1>
        
        <p style={{
          color: 'rgba(255, 255, 255, 0.7)',
          marginBottom: '30px'
        }}>
          Teste a conexão com a API do Digisac e visualize tickets abertos
        </p>

        <button
          onClick={runTest}
          disabled={loading}
          style={{
            padding: '14px 32px',
            fontSize: '1rem',
            fontWeight: '600',
            background: loading ? 'rgba(34, 211, 238, 0.3)' : 'rgba(34, 211, 238, 0.2)',
            border: '1px solid rgba(34, 211, 238, 0.5)',
            borderRadius: '8px',
            color: '#22d3ee',
            cursor: loading ? 'wait' : 'pointer',
            transition: 'all 0.3s ease',
            marginBottom: '30px'
          }}
          onMouseEnter={(e) => {
            if (!loading) {
              e.currentTarget.style.background = 'rgba(34, 211, 238, 0.3)';
              e.currentTarget.style.borderColor = '#22d3ee';
            }
          }}
          onMouseLeave={(e) => {
            if (!loading) {
              e.currentTarget.style.background = 'rgba(34, 211, 238, 0.2)';
              e.currentTarget.style.borderColor = 'rgba(34, 211, 238, 0.5)';
            }
          }}
        >
          {loading ? '⏳ Executando teste...' : '▶️ Executar Teste'}
        </button>

        {summary && (
          <div style={{
            background: 'rgba(120, 255, 163, 0.1)',
            border: '1px solid rgba(120, 255, 163, 0.3)',
            borderRadius: '12px',
            padding: '20px',
            marginBottom: '20px'
          }}>
            <h2 style={{ margin: '0 0 16px 0', color: '#78ffa3', fontSize: '1.3rem' }}>
              📊 Resumo
            </h2>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '16px' }}>
              <div>
                <div style={{ fontSize: '0.85rem', color: 'rgba(255, 255, 255, 0.6)', marginBottom: '4px' }}>
                  Departamentos
                </div>
                <div style={{ fontSize: '1.5rem', fontWeight: '700', color: '#78ffa3' }}>
                  {summary.totalDepartments}
                </div>
              </div>
              <div>
                <div style={{ fontSize: '0.85rem', color: 'rgba(255, 255, 255, 0.6)', marginBottom: '4px' }}>
                  Dept. VIP Encontrado
                </div>
                <div style={{ fontSize: '1.5rem', fontWeight: '700', color: summary.vipDepartmentFound ? '#78ffa3' : '#ef4444' }}>
                  {summary.vipDepartmentFound ? '✅' : '❌'}
                </div>
              </div>
              <div>
                <div style={{ fontSize: '0.85rem', color: 'rgba(255, 255, 255, 0.6)', marginBottom: '4px' }}>
                  Tickets Abertos
                </div>
                <div style={{ fontSize: '1.5rem', fontWeight: '700', color: '#fbbf24' }}>
                  {summary.totalOpenTickets}
                </div>
              </div>
            </div>
          </div>
        )}

        {logs.length > 0 && (
          <div style={{
            background: 'rgba(0, 0, 0, 0.4)',
            border: '1px solid rgba(34, 211, 238, 0.3)',
            borderRadius: '12px',
            padding: '20px',
            fontFamily: 'monospace',
            fontSize: '0.9rem',
            lineHeight: '1.6',
            maxHeight: '600px',
            overflow: 'auto'
          }}>
            <h2 style={{ 
              margin: '0 0 16px 0', 
              color: '#22d3ee', 
              fontSize: '1.2rem',
              fontFamily: 'system-ui, -apple-system, sans-serif'
            }}>
              📋 Logs
            </h2>
            {logs.map((log, idx) => (
              <div
                key={idx}
                style={{
                  marginBottom: '4px',
                  color: log.includes('❌') || log.includes('Erro') ? '#ef4444' :
                         log.includes('✅') ? '#78ffa3' :
                         log.includes('⚠️') ? '#fbbf24' :
                         log.includes('📌') || log.includes('📋') ? '#22d3ee' :
                         'rgba(255, 255, 255, 0.9)',
                  whiteSpace: 'pre-wrap'
                }}
              >
                {log}
              </div>
            ))}
          </div>
        )}

        {!loading && logs.length === 0 && (
          <div style={{
            textAlign: 'center',
            padding: '60px 20px',
            color: 'rgba(255, 255, 255, 0.5)',
            fontSize: '1.1rem'
          }}>
            👆 Clique no botão acima para executar o teste
          </div>
        )}
      </div>
    </div>
  );
}
