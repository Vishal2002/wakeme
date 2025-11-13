console.log('🔵 alert.workers.ts FILE LOADED');
import cron from "node-cron";
import { tripQueries } from "../database/queries.js";
import { voiceService } from "../services/voice.service.js";
import { bot } from "../services/telegram.service.js";
import type { Trip } from "../types/index.js";
// import { pool } from "../database/db.js";

export function startAlertWorker() {
  console.log("🔧 Setting up alert worker...");

  const workerFunction = async () => {
    const now = new Date().toISOString();
    console.log(`\n⏰ [${now}] Alert worker triggered`);
    
    try {
      // console.log('   📊 Querying database for trips needing alerts...');
      const trips = await tripQueries.getTripsNeedingAlerts();
        // In alert.workers.ts - after const trips = await tripQueries.getTripsNeedingAlerts();

        // console.log("   🔍 DEBUG: Checking ALL trips (ignoring filters)");
  //       const debugTrips = await pool.query(`
  //   SELECT 
  //     t.id,
  //     t.status,
  //     t.confirmed,
  //     t.alert_time,
  //     t.alert_time <= NOW() as should_alert,
  //     u.phone IS NOT NULL as has_phone,
  //     EXTRACT(EPOCH FROM (NOW() - t.alert_time)) as seconds_since_alert,
  //     EXISTS(
  //       SELECT 1 FROM call_logs 
  //       WHERE trip_id = t.id 
  //       AND created_at > NOW() - INTERVAL '10 minutes'
  //     ) as has_recent_call
  //   FROM trips t
  //   JOIN users u ON t.user_telegram_id = u.telegram_id
  //   WHERE t.type = 'bus' 
  //     AND t.status = 'active'
  //     AND t.alert_time IS NOT NULL
  // `);
  
        // console.log("   📋 All bus trips with alert_time:");
        // debugTrips.rows.forEach((row) => {
        //   console.log(`      Trip ${row.id}:`);
        //   console.log(`        - should_alert: ${row.should_alert}`);
        //   console.log(`        - has_phone: ${row.has_phone}`);
        //   console.log(`        - confirmed: ${row.confirmed}`);
        //   console.log(`        - has_recent_call: ${row.has_recent_call}`);
        //   console.log(
        //     `        - seconds_since_alert: ${row.seconds_since_alert}`
        //   );
        // });
  
        // console.log(`   🔍 Found ${trips.length} trip(s) needing alerts`);
  
        if (trips.length === 0) {
          console.log("   ✓ No trips need alerts right now");
          return;
        }
  
        for (const trip of trips) {
          console.log(`   \n   🎯 Processing trip ${trip.id}:`);
          console.log(`      - User: ${trip.user_telegram_id}`);
          console.log(`      - Type: ${trip.type}`);
          console.log(`      - Destination: ${trip.to_location}`);
          console.log(`      - Phone: ${trip.phone || "NOT SET"}`);
          console.log(`      - Alert time: ${trip.alert_time}`);
          console.log(`      - Status: ${trip.status}`);
  
          if (!trip.phone) {
            console.log(`      ❌ SKIPPED: No phone number`);
            continue;
          }
  
          console.log(`      📞 Making wake-up call...`);
  
          const tripWithPhone = trip as Trip & { phone: string };
          const callId = await voiceService.makeWakeUpCall(tripWithPhone, 1);
  
          if (callId) {
            console.log(`      ✅ Call queued: ${callId}`);
  
            // Send Telegram notification
            try {
              await bot.telegram.sendMessage(
                trip.user_telegram_id,
                "📞 Calling you now to wake you up!"
              );
              console.log(`      ✅ Telegram notification sent`);
            } catch (telegramError) {
              console.error(
                `      ⚠️ Telegram notification failed:`,
                telegramError
              );
            }
          } else {
            console.log(`      ❌ Call failed to queue`);
          }
        }
  
        console.log(`   ✓ Alert worker cycle complete\n`);

    } catch (error) {
      console.error("   ❌ Alert worker error:", error);
      console.error("   Stack:", (error as Error).stack);
    }
  };

  console.log('🚀 Running alert worker immediately...');
  workerFunction();
  
  // ✅ Then schedule for every minute
  const task = cron.schedule('* * * * *', workerFunction);
  
  console.log('✅ Alert worker started (runs every 1 minute)');
  task.start();
  console.log('   Status: RUNNING');

}
  


