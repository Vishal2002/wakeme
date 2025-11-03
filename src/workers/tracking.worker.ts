import cron from 'node-cron';
import { pool } from '../database/db.js';
import { tripQueries } from '../database/queries.js';
import { locationService } from '../services/location.service.js';
import { voiceService } from '../services/voice.service.js';
import { bot } from '../services/telegram.service.js';
import type { Trip } from '../types/index.js';

export function startTrackingWorker() {
  // Track bus locations every 2 minutes
  cron.schedule('*/2 * * * *', async () => {
    try {
      const busTrips = await tripQueries.getActiveBusTrips();
      
      for (const trip of busTrips) {
        const distance = locationService.calculateDistance(
          trip.current_lat!,
          trip.current_lng!,
          trip.destination_lat!,
          trip.destination_lng!
        );

        console.log(`🚌 Trip ${trip.id}: ${distance.toFixed(1)} km away`);

        // If within 30km and no alert set yet
        if (distance <= 30 && !trip.alert_time && trip.phone) {
          await pool.query(
            'UPDATE trips SET alert_time = NOW() WHERE id = $1',
            [trip.id]
          );
          
          // ✅ FIXED: TypeScript narrowing - assert phone as required since checked
          const tripWithPhone = trip as Trip & { phone: string };
          await voiceService.makeWakeUpCall(tripWithPhone, 1);
          
          await bot.telegram.sendMessage(
            trip.user_telegram_id,
            `🔔 WAKE UP TIME!\n📍 ${distance.toFixed(1)} km to ${trip.to_location}\n📞 Calling you now...`
          );
        }
      }
    } catch (error) {
      console.error('❌ Tracking worker error:', error);
    }
  });

  console.log('✅ Tracking worker started (runs every 2 minutes)');
}