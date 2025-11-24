import cron from 'node-cron';
import { pool } from '../database/db.js';
import { tripQueries } from '../database/queries.js';
import { locationService } from '../services/location.service.js';
import { trainService } from '../services/train.service.js';
import { bot } from '../services/telegram.service.js';

export function startTrackingWorker() {
  console.log('🔧 Setting up tracking worker...');
  
  const workerFunction = async () => {
    const now = new Date().toISOString();
    console.log(`\n🚌 [${now}] Tracking worker triggered`);
    
    try {
      // Get both bus and train trips
      const busTrips = await tripQueries.getActiveBusTrips();
      const trainTrips = await tripQueries.getActiveTrainTrips();

      // ============================================
      // BUS TRACKING
      // ============================================
      if (busTrips.length === 0) {
        console.log('   ✓ No active bus trips to track');
      } else {
        console.log(`   🚌 Found ${busTrips.length} active bus trip(s)`);
        
        for (const trip of busTrips) {
          console.log(`   \n   🎯 Tracking bus trip ${trip.id}:`);
          console.log(`      - Destination: ${trip.to_location}`);
          console.log(`      - Current: (${trip.current_lat}, ${trip.current_lng})`);

          if (!trip.current_lat || !trip.destination_lat) {
            console.log(`      ⚠️ SKIPPED: Missing location data`);
            continue;
          }

          const distance = locationService.calculateDistance(
            trip.current_lat,
            trip.current_lng!,
            trip.destination_lat,
            trip.destination_lng!
          );

          console.log(`      📏 Distance: ${distance.toFixed(2)} km`);

          const hasAlerted = !!trip.alert_time;

          if (distance <= 7 && !hasAlerted) {
            console.log(`      🚨 CRITICAL ZONE: Distance ≤ 7km - SETTING ALERT TIME`);
            
            await pool.query(
              'UPDATE trips SET alert_time = NOW() WHERE id = $1',
              [trip.id]
            );

            console.log(`      ✅ Alert time set for trip ${trip.id}`);
            
            await bot.telegram.sendMessage(
              trip.user_telegram_id,
              `🚨 APPROACHING DESTINATION!\n📏 ${distance.toFixed(1)} km to ${trip.to_location}\n📞 You'll receive a wake-up call shortly...`
            );
            
          } else if (distance <= 15 && distance > 7 && !hasAlerted) {
            console.log(`      ⚠️ Warning zone: ${distance.toFixed(1)} km`);
            
            await bot.telegram.sendMessage(
              trip.user_telegram_id,
              `⚠️ Getting close!\n📏 ${distance.toFixed(1)} km to ${trip.to_location}\n⏰ ~${Math.round(distance/40*60)} mins remaining`
            );
            
          } else if (hasAlerted) {
            console.log(`      ✓ Alert already triggered at ${trip.alert_time}`);
          } else {
            console.log(`      ✓ Still traveling: ${distance.toFixed(1)} km away`);
          }
        }
      }

      // ============================================
      // TRAIN TRACKING
      // ============================================
      if (trainTrips.length === 0) {
        console.log('   ✓ No active train trips to track');
      } else {
        console.log(`\n   🚆 Found ${trainTrips.length} active train trip(s)`);
        
        for (const trip of trainTrips) {
          console.log(`\n   🎯 Tracking train trip ${trip.id}:`);
          console.log(`      - Train: ${trip.train_name} (${trip.train_number})`);
          console.log(`      - Destination: ${trip.to_location}`);

          if (!trip.train_number || !trip.departure_time || !trip.to_location) {
            console.log(`      ⚠️ SKIPPED: Missing train data`);
            continue;
          }

          const journeyDate = trainService.formatDateForAPI(new Date(trip.departure_time));
          
          const liveStatus = await trainService.getLiveTrainStatus(
            trip.train_number,
            journeyDate,
            trip.to_location
          );

          if (!liveStatus) {
            console.log(`      ⚠️ Could not fetch live status`);
            continue;
          }

          console.log(`      📍 Current: ${liveStatus.currentStation}`);
          console.log(`      ⏭️  Next: ${liveStatus.nextStation}`);
          console.log(`      🎯 Stations remaining: ${liveStatus.stationsRemaining}`);
          console.log(`      📏 Distance: ~${liveStatus.distanceRemaining} km`);
          console.log(`      ⏱️  Delay: ${liveStatus.delayMinutes} mins`);

          const hasAlerted = !!trip.alert_time;

          // Alert when 2 stations away OR 50km away (whichever comes first)
          const shouldAlert = (
            liveStatus.stationsRemaining <= 2 || 
            liveStatus.distanceRemaining <= 50
          ) && !hasAlerted;

          if (shouldAlert) {
            console.log(`      🚨 TRAIN ALERT TRIGGERED!`);
            console.log(`         Conditions met:`);
            console.log(`         - Stations remaining: ${liveStatus.stationsRemaining} (threshold: ≤2)`);
            console.log(`         - Distance remaining: ${liveStatus.distanceRemaining}km (threshold: ≤50km)`);
            
            // ✅ Update alert_time and verify
            const updateResult = await pool.query(
              `UPDATE trips 
               SET alert_time = NOW(), updated_at = NOW() 
               WHERE id = $1 
               RETURNING id, alert_time, confirmed, status`,
              [trip.id]
            );
            
            if (updateResult.rows.length > 0) {
              const updated = updateResult.rows[0];
              console.log(`      ✅ Database updated successfully:`);
              console.log(`         - Trip ID: ${updated.id}`);
              console.log(`         - Alert time: ${updated.alert_time}`);
              console.log(`         - Confirmed: ${updated.confirmed}`);
              console.log(`         - Status: ${updated.status}`);
              
              // Verify the trip will be picked up by alert worker
              console.log(`      🔍 Verification:`);
              console.log(`         - alert_time <= NOW()? ${new Date(updated.alert_time) <= new Date() ? 'YES ✅' : 'NO ❌'}`);
              console.log(`         - confirmed = false? ${updated.confirmed === false ? 'YES ✅' : 'NO ❌'}`);
              console.log(`         - status = active? ${updated.status === 'active' ? 'YES ✅' : 'NO ❌'}`);
            } else {
              console.log(`      ❌ Database update failed - no rows returned`);
            }
            
            const avgSpeed = 60;
            const etaMinutes = Math.round((liveStatus.distanceRemaining / avgSpeed) * 60);
            
            await bot.telegram.sendMessage(
              trip.user_telegram_id,
              `🚆 APPROACHING ${trip.to_location}!\n\n` +
              `📍 Current: ${liveStatus.currentStation}\n` +
              `⭐ Next: ${liveStatus.nextStation}\n` +
              `🎯 ${liveStatus.stationsRemaining} station(s) away\n` +
              `📏 ~${liveStatus.distanceRemaining} km remaining\n` +
              `⏱️ Delay: ${liveStatus.delayMinutes > 0 ? `+${liveStatus.delayMinutes}` : '0'} mins\n` +
              `⏰ ETA: ~${etaMinutes} mins\n\n` +
              `📞 You'll receive a wake-up call shortly...`
            );
            
            console.log(`      ✅ Telegram alert sent to user ${trip.user_telegram_id}`);
          } else if (hasAlerted) {
            console.log(`      ✓ Alert already triggered at ${trip.alert_time}`);
          } else {
            console.log(`      ℹ️ Still traveling: ${liveStatus.stationsRemaining} stations, ~${liveStatus.distanceRemaining} km`);
            
            // Optional: Send update when 5 stations away
            if (liveStatus.stationsRemaining === 5) {
              await bot.telegram.sendMessage(
                trip.user_telegram_id,
                `ℹ️ Update: 5 stations to go!\n📍 Current: ${liveStatus.currentStation}`
              );
            }
          }
        }
      }

      console.log(`   ✅ Tracking worker cycle complete\n`);

    } catch (error) {
      console.error('   ❌ Tracking worker error:', error);
    }
  };
  
  console.log('🚀 Running tracking worker immediately...');
  workerFunction();
  
  // Check every 5 minutes for both bus and train
  const task = cron.schedule('*/3 * * * *', workerFunction);
  
  console.log('✅ Tracking worker started (runs every 3 minutes)');
  task.start();
  console.log('   Status: RUNNING');
}