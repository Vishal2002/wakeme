import cron from 'node-cron';
import { tripQueries } from '../database/queries.js';
import { voiceService } from '../services/voice.service.js';
import { bot } from '../services/telegram.service.js';

export function startAlertWorker() {
  // Check every minute for trips needing alerts
  cron.schedule('* * * * *', async () => {
    try {
      const trips = await tripQueries.getTripsNeedingAlerts();
      
      console.log(`🔍 Found ${trips.length} trips needing alerts`);

      for (const trip of trips) {
        if (trip.phone) {
          console.log(`📞 Making wake-up call for trip ${trip.id}`);
          
          await voiceService.makeWakeUpCall(trip, trip.phone, 1);
          
          await bot.telegram.sendMessage(
            trip.user_telegram_id,
            '📞 Calling you now to wake you up!'
          );
        }
      }
    } catch (error) {
      console.error('❌ Alert worker error:', error);
    }
  });

  console.log('✅ Alert worker started (runs every 1 minute)');
}