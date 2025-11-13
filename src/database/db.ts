import { Pool } from 'pg';
import { config } from '../config/env.js';

export const pool = new Pool({
  connectionString: config.DATABASE_URL,
  

  ssl: { rejectUnauthorized: false },
  
  
  max: 10,                         
  min: 2,                          
  idleTimeoutMillis: 60000,         
  connectionTimeoutMillis: 10000,   
  
  // ✅ TCP keep-alive settings (CRITICAL for Neon)
  keepAlive: true,
  keepAliveInitialDelayMillis: 10000, // Start sending keep-alive packets after 10s
  
  // ✅ Query timeout
  query_timeout: 30000,             // Queries timeout after 30s
  statement_timeout: 30000,         // Statements timeout after 30s
  
  // ✅ Application name (helps with debugging in Neon dashboard)
  application_name: 'wakeme-travel-bot',
});

// Handle unexpected errors
pool.on('error', (err) => {
  console.error('❌ Unexpected database pool error:', err);
  // Don't exit - pool will automatically reconnect
});

// Handle client connection errors
pool.on('connect', (client) => {
  console.log('🔗 New database connection established');
  
  // Set connection-level parameters
  client.query(`SET statement_timeout = 30000`);
  client.query(`SET idle_in_transaction_session_timeout = 60000`);
});

// Handle client removal from pool
pool.on('remove', (client) => {
  console.log('🔌 Database connection removed from pool');
});

// Test initial connection
(async () => {
  try {
    const client = await pool.connect();
    console.log('✅ Database connected successfully');
    
    // Test query
    const result = await client.query('SELECT NOW(), pg_backend_pid() as pid');
    console.log(`   📊 Server time: ${result.rows[0].now}`);
    console.log(`   🆔 Backend PID: ${result.rows[0].pid}`);
    
    client.release();
  } catch (err) {
    console.error('❌ Error connecting to database:', err);
    // Don't exit - let app continue and retry
  }
})();

// ✅ Graceful shutdown
process.on('SIGINT', async () => {
  console.log('\n⏹️  Closing database connections...');
  await pool.end();
  console.log('✅ Database pool closed');
  process.exit(0);
});

process.on('SIGTERM', async () => {
  console.log('\n⏹️  Closing database connections...');
  await pool.end();
  console.log('✅ Database pool closed');
  process.exit(0);
});