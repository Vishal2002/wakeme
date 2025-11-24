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
      const trips = await tripQueries.getTripsNeedingAlerts();
      
      if (trips.length === 0) {
        console.log("   ✓ No trips need alerts right now");
        
        // ✅ DEBUG: Check ALL active trips to see why they don't match
        const { pool } = await import("../database/db.js");
        const debugResult = await pool.query(`
          SELECT 
            t.id,
            t.type,
            t.status,
            t.confirmed,
            t.alert_time,
            t.to_location,
            CASE 
              WHEN t.alert_time IS NULL THEN 'NO ALERT TIME'
              WHEN t.alert_time > NOW() THEN CONCAT('FUTURE (+', ROUND(EXTRACT(EPOCH FROM (t.alert_time - NOW()))/60), ' min)')
              ELSE CONCAT('PAST (-', ROUND(EXTRACT(EPOCH FROM (NOW() - t.alert_time))/60), ' min)')
            END as alert_time_status,
            u.phone IS NOT NULL as has_phone,
            u.phone,
            (
              SELECT COUNT(*) 
              FROM call_logs 
              WHERE trip_id = t.id 
              AND created_at > NOW() - INTERVAL '5 minutes'
            ) as recent_call_count
          FROM trips t
          JOIN users u ON t.user_telegram_id = u.telegram_id
          WHERE t.status = 'active'
          ORDER BY t.created_at DESC
          LIMIT 10
        `);
        
        if (debugResult.rows.length > 0) {
          console.log("   🔍 Active trips that didn't match alert criteria:");
          debugResult.rows.forEach((row, i) => {
            console.log(`\n      ${i + 1}. Trip ${row.id} (${row.type} to ${row.to_location}):`);
            console.log(`         - status: "${row.status}" ${row.status === 'active' ? '✅' : '❌ (needs: active)'}`);
            console.log(`         - confirmed: ${row.confirmed} ${row.confirmed === false ? '✅' : '❌ (needs: false)'}`);
            console.log(`         - alert_time: ${row.alert_time_status}`);
            console.log(`         - has_phone: ${row.has_phone ? '✅' : '❌'} (${row.phone || 'NULL'})`);
            console.log(`         - recent_calls: ${row.recent_call_count} ${row.recent_call_count === 0 ? '✅' : '❌ (needs: 0)'}`);
            
            // Show why it doesn't match
            const reasons = [];
            if (row.status !== 'active') reasons.push('status not active');
            if (row.confirmed !== false) reasons.push('already confirmed');
            if (!row.alert_time) reasons.push('no alert_time set');
            if (row.alert_time && row.alert_time > new Date()) reasons.push('alert_time in future');
            if (!row.has_phone) reasons.push('no phone number');
            if (row.recent_call_count > 0) reasons.push('recent call exists');
            
            if (reasons.length > 0) {
              console.log(`         ❌ Blocked by: ${reasons.join(', ')}`);
            } else {
              console.log(`         ⚠️ Should match but doesn't - investigate SQL!`);
            }
          });
        } else {
          console.log("   ℹ️ No active trips found in database");
        }
        
        return;
      }

      // Process trips that need alerts
      for (const trip of trips) {
        console.log(`\n   🎯 Processing trip ${trip.id}:`);
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

          try {
            await bot.telegram.sendMessage(
              trip.user_telegram_id,
              "📞 Calling you now to wake you up!"
            );
            console.log(`      ✅ Telegram notification sent`);
          } catch (telegramError) {
            console.error(`      ⚠️ Telegram notification failed:`, telegramError);
          }
        } else {
          console.log(`      ❌ Call failed to queue`);
        }
      }

      console.log(`\n   ✅ Alert worker cycle complete`);

    } catch (error) {
      console.error("   ❌ Alert worker error:", error);
      console.error("   Stack:", (error as Error).stack);
    }
  };

  console.log('🚀 Running alert worker immediately...');
  workerFunction();
  
  const task = cron.schedule('* * * * *', workerFunction);
  
  console.log('✅ Alert worker started (runs every 1 minute)');
  task.start();
  console.log('   Status: RUNNING');
}
  


