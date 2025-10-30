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
bot.command("start", handleStart);
bot.command("status", handleStatus);
bot.command("cancel", handleCancel);
bot.command("awake", handleAwake);
bot.command("help", handleHelp);

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

app.post("/webhooks/call-complete", async (req, res) => {
  const { call_id, status, transcript, duration, metadata } = req.body;

  console.log(`📞 Call ${call_id} completed:`, status);

  // Update call log with transcript
  if (transcript) {
    const { callQueries } = await import("./database/queries.js");
    await callQueries.updateCallTranscript(call_id, transcript, duration);
  }

  // Check if user confirmed they're awake
  const confirmedKeywords = ["awake", "yes", "i'm up", "ready", "okay"];
  const isAwake =
    transcript &&
    confirmedKeywords.some((keyword) =>
      transcript.toLowerCase().includes(keyword)
    );

  if (isAwake && metadata?.trip_id) {
    const { tripQueries } = await import("./database/queries.js");
    await tripQueries.markTripComplete(metadata.trip_id);

    // Notify user via Telegram
    const trip = await tripQueries.getActiveTrip(metadata.trip_id);
    if (trip) {
      await bot.telegram.sendMessage(
        trip.user_telegram_id,
        "✅ Great! You're awake!\nHave a safe journey! 🎉"
      );
    }
  } else if (metadata?.trip_id && metadata?.attempt < 5) {
    // Schedule retry in 2 minutes
    setTimeout(async () => {
      const { voiceService } = await import("./services/voice.service.js");
      const { tripQueries } = await import("./database/queries.js");
      const trips: TripWithUser[] = await tripQueries.getTripsNeedingAlerts();

      for (const trip of trips) {
        if (trip.phone) {
          await voiceService.makeWakeUpCall(trip, trip.phone, 1);
        }
      }
    }, 2 * 60 * 1000);
  }

  res.sendStatus(200);
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
