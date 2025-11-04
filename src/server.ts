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
bot.command('debug', handleDebug);  // ADD THIS LINE

// Button handlers (MUST come before text handler)
bot.hears("🚌 Bus", handleBusButton);
bot.hears("🚆 Train", handleTrainButton);
bot.hears("📊 Status", handleStatus);
bot.hears("❌ Cancel", handleCancel);

// Message handlers - ORDER MATTERS!
bot.on(message("contact"), handleContact); // Contact BEFORE text
bot.on(message("location"), handleLocation); // Location BEFORE text
bot.on(message("text"), handleText); // Text handler LAST

// Callback handlers
bot.action("confirm_train", handleConfirmTrain);
bot.action("cancel_train", handleCancelTrain);


// In server.ts - Add this route (after Telegram setup)
app.post('/bland/webhook', async (req, res) => {
  try {
    const event = req.body;
    console.log('📨 Bland Webhook:', event.type, 'Call ID:', event.call_id);

    if (event.type === 'call-ended' || event.type === 'transcriber-message') {
      const callId = event.call_id || event.id;
      const transcript = event.transcript || event.message || '';
      const metadata = event.metadata || {};
      const status = event.status || 'completed';

      console.log(`📞 Call ${callId} ended. Status: ${status}`);
      console.log(`Transcript: ${transcript.substring(0, 100)}...`);

      // Query DB by call_id to find trip
      const { pool } = await import('./database/db.js');
      const logResult = await pool.query(
        'SELECT trip_id, attempt_number FROM call_logs WHERE call_id = $1 ORDER BY created_at DESC LIMIT 1',
        [callId]
      );

      if (logResult.rows.length === 0) {
        console.log('⚠️ No trip for call:', callId);
        return res.json({ status: 'ok' });
      }

      const { trip_id: tripId, attempt_number: attempt } = logResult.rows[0];

      // Get trip details
      const tripResult = await pool.query(
        `SELECT t.*, u.telegram_id as user_telegram_id 
         FROM trips t JOIN users u ON t.user_telegram_id = u.telegram_id 
         WHERE t.id = $1 AND t.status = 'active'`,
        [tripId]
      );

      const trip = tripResult.rows[0];
      if (!trip) return res.json({ status: 'trip_inactive' });

      // Check for awake confirmation
      const isAwake = /i['\s]?m\s+awake|yes\s+i['\s]?m\s+up|awake|ready/i.test(transcript.toLowerCase());
      console.log(`😴 Awake? ${isAwake ? 'YES ✅' : 'NO ❌'}`);

      const { tripQueries } = await import('./database/queries.js');
      const { bot } = await import('./services/telegram.service.js');

      if (isAwake) {
        // Success: Mark complete
        await tripQueries.markTripComplete(tripId);
        await bot.telegram.sendMessage(
          trip.user_telegram_id,
          `✅ Awake confirmed! Safe arrival at ${trip.to_location}! 🎉`
        );
        console.log(`✅ Trip ${tripId} completed`);
      } else if (attempt < 5) {
        // Retry in 2 mins
        setTimeout(async () => {
          const freshTrip = await pool.query(
            `SELECT t.*, u.phone FROM trips t JOIN users u ON t.user_telegram_id = u.telegram_id WHERE t.id = $1`,
            [tripId]
          );
          if (freshTrip.rows[0]?.phone) {
            await voiceService.makeWakeUpCall({ ...freshTrip.rows[0], phone: freshTrip.rows[0].phone }, attempt + 1);
            await bot.telegram.sendMessage(
              trip.user_telegram_id,
              `📞 Retry call ${attempt + 1}/5. Say "I'm awake" to confirm!`
            );
          }
        }, 120000);  // 2 minutes
        console.log(`⏰ Retry scheduled: Attempt ${attempt + 1}`);
      } else {
        // Max attempts: Emergency alert
        await bot.telegram.sendMessage(
          trip.user_telegram_id,
          `🚨 Missed 5 wake-up calls for ${trip.to_location}! Reply /awake if you're up. Emergency contact notified.`
        );
        // TODO: Notify emergency_contact if set in users table
        console.log(`🚨 Max attempts for trip ${tripId}`);
      }

      // Update call log
      await pool.query(
        'UPDATE call_logs SET status = $1, transcript = $2, duration = $3 WHERE call_id = $4',
        [status, transcript, event.duration || 0, callId]
      );
    }

    res.status(200).json({ status: 'received' });
  } catch (error) {
    console.error('❌ Bland webhook error:', error);
    res.status(500).json({ error: 'internal_error' });
  }
});

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
    });

    // Start Telegram bot
    await bot.launch();
    console.log("🤖 Telegram bot is running!");

    // Start background workers
    console.log("🔥 Before starting workers...");
    startAlertWorker();
    startTrackingWorker();
    console.log("🔥 After starting workers...");
    

    // Graceful shutdown
    process.once("SIGINT", () => bot.stop("SIGINT"));
    process.once("SIGTERM", () => bot.stop("SIGTERM"));
  } catch (error) {
    console.error("❌ Failed to start server:", error);
    process.exit(1);
  }
}

startServer();
