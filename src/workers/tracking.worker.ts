import cron from 'node-cron';
import { pool } from '../database/db.js';
import { tripQueries } from '../database/queries.js';
import { locationService } from '../services/location.service.js';
import { bot } from '../services/telegram.service.js';



export function startTrackingWorker() {
  console.log('🔧 Setting up tracking worker...');
  
  const workerFunction = async () => {
    const now = new Date().toISOString();
    console.log(`\n🚌 [${now}] Tracking worker triggered`);
    
    try {
      // console.log('   📊 Querying database for active bus trips...');
      const busTrips = await tripQueries.getActiveBusTrips();
      // console.log(`   🔍 Found ${busTrips.length} active bus trip(s)`);

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
        
        // if (minutesSinceUpdate > 10) {
        //   console.log(`      ⚠️ WARNING: Location stale (${minutesSinceUpdate.toFixed(1)} mins old)`);
          
        //   // Check if we already sent stale warning
        //   const sentStaleCheck = await pool.query(
        //     'SELECT status FROM trips WHERE id = $1',
        //     [trip.id]
        //   );
          
        //   if (sentStaleCheck.rows[0]?.status === 'active') {
        //     await pool.query(
        //       'UPDATE trips SET status = $1 WHERE id = $2',
        //       ['stale_location', trip.id]
        //     );
            
        //     await bot.telegram.sendMessage(
        //       trip.user_telegram_id,
        //       '⚠️ Live location stopped updating!\n\n' +
        //       'Please share live location again to continue tracking.'
        //     );
        //   }
        //   continue;
        // }

        const distance = locationService.calculateDistance(
          trip.current_lat,
          trip.current_lng!,
          trip.destination_lat,
          trip.destination_lng!
        );

        console.log(`      📍 Distance: ${distance.toFixed(2)} km`);

        // 🔥 KEY FIX: Check if alert_time is already set
        const hasAlerted = !!trip.alert_time;

        // 🎯 ONLY SET alert_time - DON'T MAKE CALL HERE
        if (distance <= 7 && !hasAlerted) {
          console.log(`      🚨 CRITICAL ZONE: Distance ≤ 7km - SETTING ALERT TIME`);
          
          // ✅ Set alert_time to NOW so alert.worker picks it up
          await pool.query(
            'UPDATE trips SET alert_time = NOW() WHERE id = $1',
            [trip.id]
          );

          console.log(`      ✅ Alert time set for trip ${trip.id}`);
          
          // Send Telegram warning (but don't make call yet)
          await bot.telegram.sendMessage(
            trip.user_telegram_id,
            `🚨 APPROACHING DESTINATION!\n📍 ${distance.toFixed(1)} km to ${trip.to_location}\n📞 You'll receive a wake-up call shortly...`
          );
          
        } else if (distance <= 15 && distance > 7 && !hasAlerted) {
          // ⚠️ Warning zone - 15km away
          console.log(`      ⚠️ Warning zone: ${distance.toFixed(1)} km`);
          
          await bot.telegram.sendMessage(
            trip.user_telegram_id,
            `⚠️ Getting close!\n📍 ${distance.toFixed(1)} km to ${trip.to_location}\n⏰ ~${Math.round(distance/40*60)} mins remaining`
          );
          
        } else if (distance <= 30 && distance > 15 && !hasAlerted) {
          // ℹ️ Info zone - 30km away
          console.log(`      ℹ️ Info zone: ${distance.toFixed(1)} km`);
          
          await bot.telegram.sendMessage(
            trip.user_telegram_id,
            `ℹ️ Approaching destination\n📍 ${distance.toFixed(1)} km to ${trip.to_location}`
          );
          
        } else if (hasAlerted) {
          console.log(`      ✓ Alert already triggered at ${trip.alert_time}`);
        } else {
          console.log(`      ✓ Still traveling: ${distance.toFixed(1)} km away`);
        }
      }

      console.log(`   ✓ Tracking worker cycle complete\n`);

    } catch (error) {
      console.error('   ❌ Tracking worker error:', error);
    }
  };
  
  // ✅ Run immediately on startup
  console.log('🚀 Running tracking worker immediately...');
  workerFunction();
  
  // ✅ Then schedule for every 2 minutes
  const task = cron.schedule('*/2 * * * *', workerFunction);
  
  console.log('✅ Tracking worker started (runs every 2 minutes)');
  task.start();
  console.log('   Status: RUNNING');
}