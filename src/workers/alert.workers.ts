import cron from 'node-cron';
import { tripQueries } from '../database/queries.js';
import { voiceService } from '../services/voice.service.js';
import { bot } from '../services/telegram.service.js';
import type { Trip } from '../types/index.js';

export function startAlertWorker() {
  console.log('🔧 Setting up alert worker...');
  
  // Check every minute for trips needing alerts
  const task = cron.schedule('* * * * *', async () => {
    const now = new Date().toISOString();
    console.log(`\n⏰ [${now}] Alert worker triggered`);
    
    try {
      console.log('   📊 Querying database for trips needing alerts...');
      
      const trips = await tripQueries.getTripsNeedingAlerts();
      
      console.log(`   🔍 Found ${trips.length} trip(s) needing alerts`);

      if (trips.length === 0) {
        console.log('   ✓ No trips need alerts right now');
        return;
      }

      for (const trip of trips) {
        console.log(`   \n   🎯 Processing trip ${trip.id}:`);
        console.log(`      - User: ${trip.user_telegram_id}`);
        console.log(`      - Type: ${trip.type}`);
        console.log(`      - Destination: ${trip.to_location}`);
        console.log(`      - Phone: ${trip.phone || 'NOT SET'}`);
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
              '📞 Calling you now to wake you up!'
            );
            console.log(`      ✅ Telegram notification sent`);
          } catch (telegramError) {
            console.error(`      ⚠️ Telegram notification failed:`, telegramError);
          }
        } else {
          console.log(`      ❌ Call failed to queue`);
        }
      }

      console.log(`   ✓ Alert worker cycle complete\n`);

    } catch (error) {
      console.error('   ❌ Alert worker error:', error);
      console.error('   Stack:', (error as Error).stack);
    }
  });

  // Verify cron is scheduled
  console.log('✅ Alert worker started (runs every 1 minute)');
  // console.log(`   Schedule: ${task.options.scheduled ? 'ACTIVE' : 'INACTIVE'}`);
  // console.log(`   Timezone: ${task.timezone || 'system default'}`);
  
  // Start the task
  task.start();
  console.log('   Status: RUNNING');
}