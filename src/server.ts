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
import type { TripWithUser } from "./types/index.js";

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

// ============================================
// WEBHOOKS - AI VOICE CALL CALLBACKS
// ============================================

// VAPI webhook endpoint
app.post('/webhooks/vapi-call-complete', async (req, res) => {
  const callData = req.body;
  
  console.log(`📞 VAPI call completed:`, callData.id);
  console.log(`   Status: ${callData.status}`);
  console.log(`   Duration: ${callData.duration}s`);
  
  // Get transcript
  const transcript = callData.transcript || '';
  const metadata = callData.metadata || {};
  
  console.log(`   Transcript: ${transcript.substring(0, 100)}...`);
  
  // Check if user confirmed they're awake
  const confirmedKeywords = [
    "i'm awake", "i am awake", "yes i'm up", 
    "i'm up", "awake", "yes", "okay i'm ready"
  ];
  
  const transcriptLower = transcript.toLowerCase();
  const isAwake = confirmedKeywords.some(keyword => 
    transcriptLower.includes(keyword)
  );
  
  console.log(`   User awake: ${isAwake ? 'YES ✅' : 'NO ❌'}`);
  
  if (isAwake && metadata.trip_id) {
    const { tripQueries } = await import('./database/queries.js');
    await tripQueries.markTripComplete(metadata.trip_id);
    
    console.log(`✅ Marked trip ${metadata.trip_id} as complete`);
    
    // Notify user via Telegram
    await bot.telegram.sendMessage(
      metadata.user_telegram_id || metadata.trip_id,
      '✅ Great! You\'re awake!\nHave a safe journey! 🎉'
    );
  } else if (metadata.trip_id && metadata.attempt < 5) {
    // Schedule retry in 2 minutes
    console.log(`⏰ Scheduling retry in 2 minutes (attempt ${metadata.attempt + 1})`);
    
    setTimeout(async () => {
      const { tripQueries } = await import('./database/queries.js');
      const { voiceService } = await import('./services/voice.service.js');
      const { pool } = await import('./database/db.js');
      
      // Get trip and user phone
      const result = await pool.query(`
        SELECT t.*, u.phone 
        FROM trips t 
        JOIN users u ON t.user_telegram_id = u.telegram_id 
        WHERE t.id = $1
      `, [metadata.trip_id]);
      
      if (result.rows.length > 0 && result.rows[0].phone) {
        await voiceService.makeWakeUpCall(
          result.rows[0], 
          result.rows[0].phone, 
          metadata.attempt + 1
        );
      }
    }, 2 * 60 * 1000);
  }
  
  res.sendStatus(200);
});

// ============================================

// ✅ CORRECT: VAPI Server Messages endpoint
app.post('/vapi/server-messages', async (req, res) => {
  const message = req.body;
  
  console.log(`📨 VAPI Server Message:`, message.type);
  
  try {
    switch (message.type) {
      case 'end-of-call-report':
        await handleEndOfCall(message);
        break;
        
      case 'transcript':
        console.log(`💬 Transcript: ${message.transcript?.substring(0, 100)}...`);
        break;
        
      case 'status-update':
        console.log(`📊 Status: ${message.status}`);
        break;
        
      default:
        console.log(`ℹ️ Unhandled message type: ${message.type}`);
    }
    
    // Always respond 200 OK
    res.sendStatus(200);
    
  } catch (error) {
    console.error('❌ Error handling VAPI message:', error);
    res.sendStatus(500);
  }
});

async function handleEndOfCall(message: any) {
  console.log(`📞 Call ended:`, message.call?.id);
  console.log(`   Duration: ${message.call?.duration}s`);
  console.log(`   Status: ${message.call?.status}`);
  
  const transcript = message.transcript || '';
  const metadata = message.call?.metadata || {};
  
  console.log(`   Full transcript length: ${transcript.length} chars`);
  
  // Check if user confirmed they're awake
  const confirmedKeywords = [
    "i'm awake", "i am awake", 
    "yes i'm up", "i'm up", 
    "awake", "yes", "ready"
  ];
  
  const transcriptLower = transcript.toLowerCase();
  const isAwake = confirmedKeywords.some(keyword => 
    transcriptLower.includes(keyword)
  );
  
  console.log(`   User awake: ${isAwake ? '✅ YES' : '❌ NO'}`);
  
  if (isAwake && metadata.trip_id) {
    // Mark trip complete
    const { tripQueries } = await import('./database/queries.js');
    await tripQueries.markTripComplete(metadata.trip_id);
    
    console.log(`✅ Marked trip ${metadata.trip_id} as complete`);
    
    // Notify via Telegram
    if (metadata.user_telegram_id) {
      await bot.telegram.sendMessage(
        metadata.user_telegram_id,
        '✅ Great! You\'re awake!\nHave a safe journey! 🎉'
      );
    }
    
  } else if (metadata.trip_id && metadata.attempt < 5) {
    // User didn't confirm - schedule retry
    const attempt = metadata.attempt || 1;
    
    console.log(`⏰ Scheduling retry in 2 minutes (attempt ${attempt + 1}/5)`);
    
    setTimeout(async () => {
      const { voiceService } = await import('./services/voice.service.js');
      const { pool } = await import('./database/db.js');
      
      // Get trip with phone number
      const result = await pool.query(`
        SELECT t.*, u.phone 
        FROM trips t 
        JOIN users u ON t.user_telegram_id = u.telegram_id 
        WHERE t.id = $1 AND t.status = 'active'
      `, [metadata.trip_id]);
      
      if (result.rows.length > 0 && result.rows[0].phone) {
        const trip = result.rows[0];
        await voiceService.makeWakeUpCall(trip, trip.phone, attempt + 1);
        
        // Notify on Telegram
        await bot.telegram.sendMessage(
          trip.user_telegram_id,
          `📞 Calling again... (Attempt ${attempt + 1}/5)\nReply 'AWAKE' to stop calls.`
        );
      }
    }, 2 * 60 * 1000); // 2 minutes
    
  } else if (metadata.trip_id && metadata.attempt >= 5) {
    // All attempts failed - notify
    console.log(`🚨 All 5 attempts failed for trip ${metadata.trip_id}`);
    
    if (metadata.user_telegram_id) {
      await bot.telegram.sendMessage(
        metadata.user_telegram_id,
        '🚨 MISSED 5 CALLS!\n\nYou didn\'t respond to any wake-up calls.\nReply "AWAKE" if you\'re up, or your emergency contact will be notified.'
      );
    }
  }
}

// ============================================ 

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
    startAlertWorker();
    startTrackingWorker();

    // Graceful shutdown
    process.once("SIGINT", () => bot.stop("SIGINT"));
    process.once("SIGTERM", () => bot.stop("SIGTERM"));
  } catch (error) {
    console.error("❌ Failed to start server:", error);
    process.exit(1);
  }
}

startServer();
