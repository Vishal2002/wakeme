import dotenv from 'dotenv';
dotenv.config();

export const config = {
  // Server
  PORT: process.env.PORT || 3000,
  SERVER_URL: process.env.SERVER_URL || 'http://localhost:3000',
  
  // Database
  DATABASE_URL: process.env.DATABASE_URL!,
  
  // Telegram
  TELEGRAM_BOT_TOKEN: process.env.TELEGRAM_BOT_TOKEN!,
  TELEGRAM_BOT_USERNAME: process.env.TELEGRAM_BOT_USERNAME,
  
  // AI Voice Service - Bland.ai
  BLAND_API_KEY: process.env.BLAND_API_KEY!,
  
  // Optional APIs
  GOOGLE_MAPS_API_KEY: process.env.GOOGLE_MAPS_API_KEY,
  RAILWAY_API_KEY: process.env.RAILWAY_API_KEY,
};

// Validate required env vars
const required = ['DATABASE_URL', 'TELEGRAM_BOT_TOKEN', 'BLAND_API_KEY'];
for (const key of required) {
  if (!process.env[key]) {
    throw new Error(`❌ Missing required environment variable: ${key}`);
  }
}

console.log('✅ Environment variables loaded successfully');