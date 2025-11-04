import { pool } from './database/db.js';
import { tripQueries } from './database/queries.js';
import { voiceService } from './services/voice.service.js';
import dotenv from 'dotenv';

dotenv.config();

async function testCronLogic() {
  console.log('🧪 Testing cron logic manually...\n');

  try {
    // Test 1: Check database connection
    console.log('1️⃣ Testing database connection...');
    const dbTest = await pool.query('SELECT NOW()');
    console.log('   ✅ Database connected:', dbTest.rows[0].now);

    // Test 2: Check for trips
    console.log('\n2️⃣ Checking for trips needing alerts...');
    const trips = await tripQueries.getTripsNeedingAlerts();
    console.log(`   Found ${trips.length} trip(s)`);

    if (trips.length === 0) {
      console.log('\n   ℹ️ No trips found. Creating test trip...');
      console.log('   Run this SQL to create a test trip:');
      console.log(`
      -- First, make sure you have a user
      INSERT INTO users (telegram_id, name, phone) 
      VALUES (123456789, 'Test User', '+919099722911')
      ON CONFLICT (telegram_id) DO NOTHING;

      -- Then create a test trip
      INSERT INTO trips (
        user_telegram_id, 
        type, 
        to_location, 
        status, 
        alert_time,
        confirmed
      ) VALUES (
        123456789, 
        'train', 
        'Mumbai', 
        'active', 
        NOW(),  -- Alert time is NOW
        FALSE
      );
      `);
    } else {
      console.log('\n   📋 Trips that need alerts:');
      trips.forEach((trip, i) => {
        console.log(`   ${i + 1}. Trip ${trip.id}:`);
        console.log(`      User: ${trip.user_telegram_id}`);
        console.log(`      Type: ${trip.type}`);
        console.log(`      Destination: ${trip.to_location}`);
        console.log(`      Phone: ${trip.phone}`);
        console.log(`      Alert time: ${trip.alert_time}`);
        console.log(`      Status: ${trip.status}`);
      });

      // Test 3: Try making a call
      console.log('\n3️⃣ Testing voice service...');
      const firstTrip = trips[0];
      
      if (firstTrip.phone) {
        console.log(`   Attempting to call ${firstTrip.phone}...`);
        const callId = await voiceService.makeWakeUpCall(
          firstTrip as any, 
          1
        );
        
        if (callId) {
          console.log(`   ✅ Call queued: ${callId}`);
          console.log('   📞 You should receive a call shortly!');
        } else {
          console.log('   ❌ Call failed');
        }
      } else {
        console.log('   ⚠️ Trip has no phone number');
      }
    }

    console.log('\n✅ Manual test complete!');

  } catch (error) {
    console.error('❌ Test failed:', error);
  } finally {
    await pool.end();
  }
}

testCronLogic();