import cron from 'node-cron';
import { pool } from '../database/db.js';
import { tripQueries } from '../database/queries.js';
import { locationService } from '../services/location.service.js';
import { voiceService } from '../services/voice.service.js';
import { bot } from '../services/telegram.service.js';
import type { Trip } from '../types/index.js';

export function startTrackingWorker() {
  console.log('🔧 Setting up tracking worker...');
  
  // Check every 5 minutes (instead of 2)
  const task = cron.schedule('*/5 * * * *', async () => {
    const now = new Date().toISOString();
    console.log(`\n🚌 [${now}] Tracking worker triggered`);
    
    try {
      console.log('   📊 Querying database for active bus trips...');
      
      const busTrips = await tripQueries.getActiveBusTrips();
      
      console.log(`   🔍 Found ${busTrips.length} active bus trip(s)`);

      if (busTrips.length === 0) {
        console.log('   ✓ No active bus trips to track');
        return;
      }

      for (const trip of busTrips) {
        console.log(`   \n   🎯 Tracking trip ${trip.id}:`);
        console.log(`      - Destination: ${trip.to_location}`);
        console.log(`      - Current: (${trip.current_lat}, ${trip.current_lng})`);

        if (!trip.current_lat || !trip.destination_lat) {
          console.log(`      ⚠️ SKIPPED: Missing location data`);
          continue;
        }

        // Check if location was updated in last 10 minutes
        const lastUpdate = new Date(trip.updated_at);
        const minutesSinceUpdate = (Date.now() - lastUpdate.getTime()) / (1000 * 60);
        
        if (minutesSinceUpdate > 10) {
          console.log(`      ⚠️ WARNING: Location stale (${minutesSinceUpdate.toFixed(1)} mins old)`);
          await bot.telegram.sendMessage(
            trip.user_telegram_id,
            '⚠️ Live location stopped updating!\n\n' +
            'Please share live location again to continue tracking.'
          );
          continue;
        }

        const distance = locationService.calculateDistance(
          trip.current_lat,
          trip.current_lng!,
          trip.destination_lat,
          trip.destination_lng!
        );

        console.log(`      📏 Distance: ${distance.toFixed(2)} km`);

        // Progressive alerts based on distance
        if (distance <= 5 && !trip.alert_time) {
          // Final alert - 5km away
          console.log(`      🚨 FINAL ALERT: Distance ≤ 5km`);
          
          await pool.query(
            'UPDATE trips SET alert_time = NOW() WHERE id = $1',
            [trip.id]
          );

          if (trip.phone) {
            const tripWithPhone = trip as Trip & { phone: string };
            const callId = await voiceService.makeWakeUpCall(tripWithPhone, 1);
            
            if (callId) {
              console.log(`      ✅ Call queued: ${callId}`);
            }

            await bot.telegram.sendMessage(
              trip.user_telegram_id,
              `🚨 WAKE UP NOW!\n📍 ${distance.toFixed(1)} km to ${trip.to_location}\n📞 Calling you...`
            );
          }
        } else if (distance <= 15 && distance > 5) {
          // Warning alert - 15km away
          console.log(`      ⚠️ Warning zone: ${distance.toFixed(1)} km`);
          
          await bot.telegram.sendMessage(
            trip.user_telegram_id,
            `⚠️ Getting close!\n📍 ${distance.toFixed(1)} km to ${trip.to_location}\n⏰ ~${Math.round(distance/40*60)} mins remaining`
          );
        } else if (distance <= 30 && distance > 15) {
          // Info alert - 30km away
          console.log(`      ℹ️ Info zone: ${distance.toFixed(1)} km`);
          
          await bot.telegram.sendMessage(
            trip.user_telegram_id,
            `ℹ️ Approaching destination\n📍 ${distance.toFixed(1)} km to ${trip.to_location}`
          );
        } else {
          console.log(`      ✓ Still traveling: ${distance.toFixed(1)} km away`);
        }
      }

      console.log(`   ✓ Tracking worker cycle complete\n`);

    } catch (error) {
      console.error('   ❌ Tracking worker error:', error);
    }
  });

  console.log('✅ Tracking worker started (runs every 5 minutes)');
  task.start();
  console.log('   Status: RUNNING');
}