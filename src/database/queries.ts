import { pool } from "./db.js";
import type { User, Trip } from "../types/index.js";


export const userQueries = {
  async getUser(telegramId: number): Promise<User | null> {
    const result = await pool.query(
      "SELECT * FROM users WHERE telegram_id = $1",
      [telegramId]
    );
    return result.rows[0] || null;
  },

  async createUser(
    telegramId: number,
    name: string,
    username?: string
  ): Promise<void> {
    await pool.query(
      `INSERT INTO users (telegram_id, name, username) 
       VALUES ($1, $2, $3) 
       ON CONFLICT (telegram_id) DO UPDATE 
       SET name = $2, username = $3, last_active = NOW()`,
      [telegramId, name, username]
    );
  },

  async updateUserPhone(telegramId: number, phone: string): Promise<void> {
    await pool.query("UPDATE users SET phone = $1 WHERE telegram_id = $2", [
      phone,
      telegramId,
    ]);
  },
};

export const tripQueries = {
  async getActiveTrip(telegramId: number): Promise<Trip | null> {
    const result = await pool.query(
      `SELECT * FROM trips 
         WHERE user_telegram_id = $1 
         AND status IN ('active', 'pending_location', 'awaiting_destination', 'awaiting_confirmation', 'awaiting_phone')
         ORDER BY created_at DESC 
         LIMIT 1`,
      [telegramId]
    );
    return result.rows[0] || null;
  },

  async createBusTrip(telegramId: number): Promise<number> {
    const result = await pool.query(
      `INSERT INTO trips (user_telegram_id, type, to_location, status) 
         VALUES ($1, 'bus', 'pending', 'pending_location') 
         RETURNING id`,
      [telegramId]
    );
    return result.rows[0].id;
  },

  async updateBusLocation(
    tripId: number,
    lat: number,
    lng: number
  ): Promise<void> {
    await pool.query(
      "UPDATE trips SET current_lat = $1, current_lng = $2, status = $3, updated_at = NOW() WHERE id = $4",
      [lat, lng, "awaiting_destination", tripId]
    );
  },

  async setBusDestination(
    tripId: number,
    destination: string,
    lat?: number,
    lng?: number
  ): Promise<void> {
    await pool.query(
      "UPDATE trips SET to_location = $1, destination_lat = $2, destination_lng = $3, status = $4, updated_at = NOW() WHERE id = $5",
      [destination, lat, lng, "awaiting_phone", tripId]
    );
  },

  async createTrainTrip(
    telegramId: number,
    pnr: string,
    trainData: any
  ): Promise<number> {
    console.log('📝 Creating train trip with data:');
    console.log('   PNR:', pnr, '(length:', pnr.length, ')');
    console.log('   Train Number:', trainData.train_number, '(length:', trainData.train_number?.length, ')');
    console.log('   Train Name:', trainData.train_name, '(length:', trainData.train_name?.length, ')');
    console.log('   From:', trainData.from, '(length:', trainData.from?.length, ')');
    console.log('   To:', trainData.to, '(length:', trainData.to?.length, ')');
    console.log('   Departure:', trainData.departure);
    console.log('   Arrival:', trainData.arrival);
    const alertTime = new Date(trainData.arrival);
    alertTime.setMinutes(alertTime.getMinutes() - 30);

    const result = await pool.query(
      `INSERT INTO trips (
          user_telegram_id, type, from_location, to_location,
          pnr, train_number, train_name, departure_time, arrival_time,
          status, alert_time
        ) VALUES ($1, 'train', $2, $3, $4, $5, $6, $7, $8, $9, $10)
        RETURNING id`,
      [
        telegramId,
        trainData.from,
        trainData.to,
        pnr,
        trainData.train_number,
        trainData.train_name,
        trainData.departure,
        trainData.arrival,
        "awaiting_confirmation",
        alertTime,
      ]
    );
    return result.rows[0].id;
  },

  async updateTripStatus(tripId: number, status: string): Promise<void> {
    await pool.query(
      "UPDATE trips SET status = $1, updated_at = NOW() WHERE id = $2",
      [status, tripId]
    );
  },

  async markTripComplete(tripId: number): Promise<void> {
    await pool.query(
      "UPDATE trips SET status = $1, confirmed = TRUE, updated_at = NOW() WHERE id = $2",
      ["completed", tripId]
    );
  },

  async cancelTrip(telegramId: number): Promise<void> {
    await pool.query(
      "UPDATE trips SET status = $1, updated_at = NOW() WHERE user_telegram_id = $2 AND status = $3",
      ["cancelled", telegramId, "active"]
    );
  },

  async getTripsNeedingAlerts(): Promise<(Trip & { phone?: string })[]> {
    const result = await pool.query(`
      SELECT 
        t.*,
        u.phone,
        u.name,
        u.username,
        u.telegram_id as user_telegram_id
      FROM trips t
      JOIN users u ON t.user_telegram_id = u.telegram_id
      WHERE t.status = 'active' 
        AND t.confirmed = FALSE 
       AND t.alert_time <= NOW() + INTERVAL '1 minute'
        AND u.phone IS NOT NULL
        AND t.id NOT IN (
          SELECT DISTINCT trip_id 
          FROM call_logs 
          WHERE created_at > NOW() - INTERVAL '10 minutes'
        )
      ORDER BY t.alert_time ASC
    `);

    console.log(`   🔎 SQL Result: ${result.rows.length} row(s)`);
    
    if (result.rows.length > 0) {
      console.log('   📋 Trips found:');
      result.rows.forEach((row, i) => {
        console.log(`      ${i + 1}. Trip ${row.id} - ${row.type} to ${row.to_location} (Alert: ${row.alert_time})`);
      });
    }

    return result.rows;
  },

  // ✅ Also joined, so better type
  async getActiveBusTrips(): Promise<
    (Trip & { phone?: string; name?: string; updated_at:Date })[]
  > {
    const result = await pool.query(`
      SELECT 
        t.*,
        u.phone,
        u.telegram_id,
        u.name
      FROM trips t
      JOIN users u ON t.user_telegram_id = u.telegram_id
      WHERE t.type = 'bus' 
        AND t.status = 'active'
        AND t.current_lat IS NOT NULL
        AND t.destination_lat IS NOT NULL
      ORDER BY t.created_at ASC
    `);

    console.log(`   🔎 SQL Result: ${result.rows.length} row(s)`);

    return result.rows;
  },

  async getActiveTrainTrips(): Promise<
    (Trip & { phone?: string; name?: string })[]
  > {
    const result = await pool.query(`
      SELECT 
        t.*,
        u.phone,
        u.telegram_id,
        u.name
      FROM trips t
      JOIN users u ON t.user_telegram_id = u.telegram_id
      WHERE t.type = 'train' 
        AND t.status = 'active'
        AND t.train_number IS NOT NULL
        AND t.departure_time IS NOT NULL
        AND t.to_location IS NOT NULL
      ORDER BY t.departure_time ASC
    `);

    console.log(`   🔎 SQL Result: ${result.rows.length} active train(s)`);

    return result.rows;
  },
};

export const callQueries = {
  async logCall(
    tripId: number,
    callId: string,
    attempt: number,
    status: string
  ): Promise<void> {
    await pool.query(
      "INSERT INTO call_logs (trip_id, call_id, attempt_number, status) VALUES ($1, $2, $3, $4)",
      [tripId, callId, attempt, status]
    );
  },

  async updateCallTranscript(
    callId: string,
    transcript: string,
    duration: number
  ): Promise<void> {
    await pool.query(
      "UPDATE call_logs SET transcript = $1, duration = $2 WHERE call_id = $3",
      [transcript, duration, callId]
    );
  },

  async getCallAttempts(tripId: number): Promise<number> {
    const result = await pool.query(
      "SELECT COUNT(*) FROM call_logs WHERE trip_id = $1",
      [tripId]
    );
    return parseInt(result.rows[0].count);
  },
};
