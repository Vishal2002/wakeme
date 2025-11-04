import cron from 'node-cron';
import { pool } from '../database/db.js';
import { tripQueries } from '../database/queries.js';
import { locationService } from '../services/location.service.js';
import { voiceService } from '../services/voice.service.js';
import { bot } from '../services/telegram.service.js';
import type { Trip } from '../types/index.js';

export function startTrackingWorker() {
  console.log('🔧 Setting up tracking worker...');
  
  // Track bus locations every 2 minutes
  const task = cron.schedule('*/2 * * * *', async () => {
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
        console.log(`      - Destination: (${trip.destination_lat}, ${trip.destination_lng})`);

        if (!trip.current_lat || !trip.destination_lat) {
          console.log(`      ⚠️ SKIPPED: Missing location data`);
          continue;
        }

        const distance = locationService.calculateDistance(
          trip.current_lat,
          //@ts-ignore
          trip.current_lng,
          trip.destination_lat,
          trip.destination_lng
        );

        console.log(`      📏 Distance: ${distance.toFixed(2)} km`);

        // If within 30km and no alert set yet
        if (distance <= 30 && !trip.alert_time) {
          console.log(`      🔔 TRIGGER: Distance ≤ 30km, setting alert...`);
          
          await pool.query(
            'UPDATE trips SET alert_time = NOW() WHERE id = $1',
            [trip.id]
          );
          console.log(`      ✅ Alert time set to NOW`);

          if (trip.phone) {
            const tripWithPhone = trip as Trip & { phone: string };
            const callId = await voiceService.makeWakeUpCall(tripWithPhone, 1);
            
            if (callId) {
              console.log(`      ✅ Call queued: ${callId}`);
            }

            await bot.telegram.sendMessage(
              trip.user_telegram_id,
              `🔔 WAKE UP TIME!\n📍 ${distance.toFixed(1)} km to ${trip.to_location}\n📞 Calling you now...`
            );
          } else {
            console.log(`      ⚠️ No phone number for trip ${trip.id}`);
          }
        } else if (distance > 30) {
          console.log(`      ✓ Still far: ${distance.toFixed(1)} km away`);
        } else if (trip.alert_time) {
          console.log(`      ✓ Alert already set: ${trip.alert_time}`);
        }
      }

      console.log(`   ✓ Tracking worker cycle complete\n`);

    } catch (error) {
      console.error('   ❌ Tracking worker error:', error);
      console.error('   Stack:', (error as Error).stack);
    }
  });

  console.log('✅ Tracking worker started (runs every 2 minutes)');
  // console.log(`   Schedule: ${task.options.scheduled ? 'ACTIVE' : 'INACTIVE'}`);
  // console.log(`   Timezone: ${task.options.timezone || 'system default'}`);
  
  task.start();
  console.log('   Status: RUNNING');
}