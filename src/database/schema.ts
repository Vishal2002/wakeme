import { pool } from './db.js';

export async function setupDatabase() {
  const client = await pool.connect();
  
  try {
    await client.query('BEGIN');
    
    await client.query(`
      CREATE TABLE IF NOT EXISTS users (
        telegram_id BIGINT PRIMARY KEY,
        phone VARCHAR(20),
        name VARCHAR(100) NOT NULL,
        username VARCHAR(100),
        language VARCHAR(10) DEFAULT 'en',
        emergency_contact VARCHAR(20),
        created_at TIMESTAMP DEFAULT NOW(),
        last_active TIMESTAMP DEFAULT NOW()
      );
    `);
    
    await client.query(`
      CREATE TABLE IF NOT EXISTS trips (
        id SERIAL PRIMARY KEY,
        user_telegram_id BIGINT REFERENCES users(telegram_id),
        type VARCHAR(10) NOT NULL CHECK (type IN ('bus', 'train')),
        from_location VARCHAR(200),
        to_location VARCHAR(200) NOT NULL,
        status VARCHAR(20) DEFAULT 'active',
        
        current_lat DECIMAL(10, 8),
        current_lng DECIMAL(11, 8),
        destination_lat DECIMAL(10, 8),
        destination_lng DECIMAL(11, 8),
        
        pnr VARCHAR(10),
        train_number VARCHAR(10),
        train_name VARCHAR(100),
        departure_time TIMESTAMP,
        arrival_time TIMESTAMP,
        
        alert_before_minutes INTEGER DEFAULT 30,
        alert_time TIMESTAMP,
        confirmed BOOLEAN DEFAULT FALSE,
        
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      );
    `);
    // Add this column to trips table
await client.query(`
  ALTER TABLE trips 
  ADD COLUMN IF NOT EXISTS location_last_updated TIMESTAMP DEFAULT NOW();
`);

// Update trigger to auto-update this timestamp
await client.query(`
  CREATE OR REPLACE FUNCTION update_location_timestamp()
  RETURNS TRIGGER AS $$
  BEGIN
    IF NEW.current_lat IS DISTINCT FROM OLD.current_lat 
       OR NEW.current_lng IS DISTINCT FROM OLD.current_lng THEN
      NEW.location_last_updated = NOW();
    END IF;
    RETURN NEW;
  END;
  $$ LANGUAGE plpgsql;

  DROP TRIGGER IF EXISTS update_location_timestamp_trigger ON trips;
  CREATE TRIGGER update_location_timestamp_trigger
    BEFORE UPDATE ON trips
    FOR EACH ROW
    EXECUTE FUNCTION update_location_timestamp();
`);
    
    await client.query(`
      CREATE TABLE IF NOT EXISTS call_logs (
        id SERIAL PRIMARY KEY,
        trip_id INTEGER REFERENCES trips(id),
        call_id VARCHAR(100),
        attempt_number INTEGER,
        status VARCHAR(20),
        duration INTEGER,
        transcript TEXT,
        created_at TIMESTAMP DEFAULT NOW()
      );
    `);
    
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_trips_status ON trips(status);
      CREATE INDEX IF NOT EXISTS idx_trips_alert_time ON trips(alert_time);
      CREATE INDEX IF NOT EXISTS idx_trips_user ON trips(user_telegram_id);
    `);
    
    await client.query('COMMIT');
    console.log('✅ Database schema setup complete!');
    
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('❌ Database setup failed:', error);
    throw error;
  } finally {
    client.release();
  }
}
