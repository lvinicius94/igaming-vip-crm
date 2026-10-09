import { Pool } from 'pg';

const pool = new Pool({
  host: process.env.PGHOST,
  port: parseInt(process.env.PGPORT || '5432'),
  user: process.env.PGUSER,
  password: process.env.PGPASSWORD,
  database: process.env.PGDATABASE,
  ssl: process.env.PGSSLMODE === 'require' ? {
    rejectUnauthorized: false,
    ca: process.env.PGSSLROOTCERT
  } : false,
  // Otimizações de pool para queries pesadas
  max: 30, // Aumentado de 20 para 30 conexões simultâneas
  idleTimeoutMillis: 60000, // Aumentado para 60s - mantém conexões quentes
  connectionTimeoutMillis: 10000, // Aumentado para 10s - queries pesadas precisam de mais tempo
  query_timeout: 120000, // 120s timeout para queries individuais (aumentado de 60s)
  statement_timeout: 120000, // 120s timeout para statements (aumentado de 60s)
  // Connection pooling otimizado
  allowExitOnIdle: false, // Mantém pool ativo
});

export default pool;
