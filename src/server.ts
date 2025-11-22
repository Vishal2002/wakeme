import express from "express";
import { config } from "./config/env.js";
import { setupDatabase } from "./database/schema.js";
import { bot } from "./services/telegram.service.js";
import {
  handleStart,
  handleStatus,
  handleCancel,
  handleAwake,
  handleHelp,
  handleDebug,
} from "./handlers/command.handlers.js";
import {
  handleBusButton,
  handleTrainButton,
  handleLocation,
  handleContact,
  handleText,
} from "./handlers/message.handlers.js";
import {
  handleConfirmTrain,
  handleCancelTrain,
} from "./handlers/callback.handlers.js";
import { startAlertWorker } from "./workers/alert.workers.js";
import { startTrackingWorker } from "./workers/tracking.worker.js";
import { message } from "telegraf/filters";
import { voiceService } from "./services/voice.service.js";

const app = express();
app.use(express.json());

// ============================================
// TELEGRAM BOT SETUP
// ============================================

// Commands
bot.command('start', handleStart);
bot.command('status', handleStatus);
bot.command('cancel', handleCancel);
bot.command('awake', handleAwake);
bot.command('help', handleHelp);
bot.command('debug', handleDebug);

// Button handlers (MUST come before text handler)
bot.hears("🚌 Bus", handleBusButton);
bot.hears("🚆 Train", handleTrainButton);
bot.hears("📊 Status", handleStatus);
bot.hears("❌ Cancel", handleCancel);

// Message handlers - ORDER MATTERS!
bot.on(message("contact"), handleContact); // Contact BEFORE text
bot.on(message("location"), handleLocation); // Initial location share
bot.on(message("text"), handleText); // Text handler LAST

// ⭐ CRITICAL: Handle live location UPDATES (edited_message)
bot.on("edited_message", async (ctx) => {
  if (!ctx.editedMessage || !('location' in ctx.editedMessage)) return;
  
  console.log('📍 [EDITED MESSAGE] Received live location update');
  
  // Call the same location handler for updates
  await handleLocation(ctx as any);
});

// Callback handlers
bot.action("confirm_train", handleConfirmTrain);
bot.action("cancel_train", handleCancelTrain);



app.post('/bland/webhook', async (req, res) => {
  try {
    const event = req.body;
    
    // ✅ LOG EVERYTHING to see what Bland sends
    console.log('📨 Bland Webhook Received:');
    console.log('   Event type:', event.type);
    console.log('   Call ID:', event.call_id);
    console.log('   Status:', event.status);
    console.log('   Full payload:', JSON.stringify(event, null, 2));

    // ✅ Respond immediately so Bland knows we got it
    res.status(200).json({ status: 'received' });

    if (event.type === 'call-ended' || event.status === 'completed') {
      console.log('🎯 Processing call-ended event');
      handleCallEnded(event).catch(err => {
        console.error('❌ Error processing call-ended:', err);
      });
    } else if (event.type === 'call-started') {
      console.log('📞 Call started');
    } else if (event.type === 'call-analyzed') {
      console.log('🔍 Call analyzed');
      handleCallEnded(event).catch(err => {
        console.error('❌ Error processing call-analyzed:', err);
      });
    } else {
      console.log('ℹ️ Unhandled event type:', event.type, 'status:', event.status);
    }

  } catch (error) {
    console.error('❌ Bland webhook error:', error);
    if (!res.headersSent) {
      res.status(200).json({ error: 'internal_error' });
    }
  }
});

// ✅ Extract the handler logic
async function handleCallEnded(event: any) {
  const callId = event.call_id || event.id;
  const transcript = event.transcript || event.concatenated_transcript || '';
  const status = event.status || 'completed';

  console.log(`📞 Call ${callId} ended. Status: ${status}`);
  console.log(`📝 Transcript: "${transcript}"`);

  // Query DB by call_id to find trip
  const { pool } = await import('./database/db.js');
  const logResult = await pool.query(
    'SELECT trip_id, attempt_number FROM call_logs WHERE call_id = $1 ORDER BY created_at DESC LIMIT 1',
    [callId]
  );

  if (logResult.rows.length === 0) {
    console.log('⚠️ No trip found for call:', callId);
    return;
  }

  const { trip_id: tripId, attempt_number: attempt } = logResult.rows[0];

  // Get trip details
  const tripResult = await pool.query(
    `SELECT t.*, u.telegram_id as user_telegram_id 
     FROM trips t JOIN users u ON t.user_telegram_id = u.telegram_id 
     WHERE t.id = $1`,
    [tripId]
  );

  const trip = tripResult.rows[0];
  if (!trip) {
    console.log('⚠️ Trip not found:', tripId);
    return;
  }

  // Check for awake confirmation - be more lenient with detection
  const lowerTranscript = transcript.toLowerCase();
  const isAwake = /i['\s]?m\s+awake|yes.*awake|awake|ready|i\s+am\s+awake|yes\s+i/i.test(lowerTranscript);
  console.log(`😴 Awake detected? ${isAwake ? 'YES ✅' : 'NO ❌'}`);
  console.log(`   Transcript to check: "${lowerTranscript}"`);

  const { tripQueries } = await import('./database/queries.js');
  const { bot } = await import('./services/telegram.service.js');

  if (isAwake) {
    // ✅ SUCCESS: Mark complete
    await tripQueries.markTripComplete(tripId);
    await bot.telegram.sendMessage(
      trip.user_telegram_id,
      `✅ Awake confirmed! Safe arrival at ${trip.to_location}! 🎉`
    );
    console.log(`✅ Trip ${tripId} marked complete`);
    
  } else if (attempt < 5 && trip.status === 'active') {
    // ⏰ RETRY: Schedule next attempt
    console.log(`⏰ Scheduling retry ${attempt + 1}/5 in 2 minutes...`);
    
    setTimeout(async () => {
      const freshTrip = await pool.query(
        `SELECT t.*, u.phone FROM trips t JOIN users u ON t.user_telegram_id = u.telegram_id WHERE t.id = $1 AND t.status = 'active'`,
        [tripId]
      );
      
      if (freshTrip.rows[0]?.phone) {
        const { voiceService } = await import('./services/voice.service.js');
        await voiceService.makeWakeUpCall(
          { ...freshTrip.rows[0], phone: freshTrip.rows[0].phone }, 
          attempt + 1
        );
        await bot.telegram.sendMessage(
          trip.user_telegram_id,
          `📞 Retry call ${attempt + 1}/5. Say "I'm awake" to confirm!`
        );
      }
    }, 120000);  // 2 minutes
    
  } else if (attempt >= 5) {
    // 🚨 MAX ATTEMPTS: Emergency alert
    await tripQueries.markTripComplete(tripId); // Stop further calls
    await bot.telegram.sendMessage(
      trip.user_telegram_id,
      `🚨 Missed 5 wake-up calls for ${trip.to_location}! Reply /awake if you're up.`
    );
    console.log(`🚨 Max attempts reached for trip ${tripId}`);
  }

  // Update call log with transcript
  // ✅ Convert duration to integer (Bland sends decimal minutes, we store seconds)
  const durationMinutes = event.duration || event.call_length || 0;
  const durationSeconds = Math.round(durationMinutes * 60);
  
  await pool.query(
    'UPDATE call_logs SET status = $1, transcript = $2, duration = $3 WHERE call_id = $4',
    [status, transcript, durationSeconds, callId]
  );
}

// Debug endpoint to monitor trips
// app.get('/debug/trips', async (req, res) => {
//   try {
//     const { pool } = await import('./database/db.js');
//     const result = await pool.query(`
//       SELECT 
//         t.id,
//         t.user_telegram_id,
//         t.type,
//         t.status,
//         t.to_location,
//         t.current_lat,
//         t.current_lng,
//         t.destination_lat,
//         t.destination_lng,
//         t.updated_at,
//         t.created_at,
//         EXTRACT(EPOCH FROM (NOW() - t.updated_at))/60 as minutes_since_update,
//         u.phone,
//         u.name
//       FROM trips t
//       JOIN users u ON t.user_telegram_id = u.telegram_id
//       WHERE t.status IN ('active', 'awaiting_phone', 'awaiting_destination', 'pending_location')
//       ORDER BY t.updated_at DESC
//     `);
    
//     res.json({
//       timestamp: new Date().toISOString(),
//       count: result.rows.length,
//       trips: result.rows.map(trip => ({
//         ...trip,
//         minutes_since_update: parseFloat(trip.minutes_since_update).toFixed(2),
//         location_fresh: parseFloat(trip.minutes_since_update) < 5
//       }))
//     });
//   } catch (error: any) {
//     res.status(500).json({ error: error.message });
//   }
// });

// Health check
app.get("/health", (req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

// ============================================
// START SERVER
// ============================================

async function startServer() {
  try {
    // Setup database
    await setupDatabase();

    // Start Express server
    app.listen(config.PORT, () => {
      console.log("\n🚀 WakeMe Travel Server Started!");
      console.log(`📡 Port: ${config.PORT}`);
      console.log(`🤖 Telegram Bot: @${config.TELEGRAM_BOT_USERNAME}`);
      console.log(`🔗 Server URL: ${config.SERVER_URL}`);
      console.log(`✅ Health: ${config.SERVER_URL}/health`);
      console.log(`🔍 Debug: ${config.SERVER_URL}/debug/trips`);
    });

     // Start background workers
     console.log("🔥 Before starting workers...");
     startAlertWorker();
     startTrackingWorker();
     console.log("🔥 After starting workers...");

    // Start Telegram bot
    bot.launch();
    console.log("🤖 Telegram bot is running!");

   
    

    // Graceful shutdown
    process.once("SIGINT", () => bot.stop("SIGINT"));
    process.once("SIGTERM", () => bot.stop("SIGTERM"));
  } catch (error) {
    console.error("❌ Failed to start server:", error);
    process.exit(1);
  }
}

startServer();