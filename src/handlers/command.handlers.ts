import { Context } from 'telegraf';
import { userQueries, tripQueries } from '../database/queries.js';
import { keyboards, formatTripStatus } from '../services/telegram.service.js';
import { locationService } from '../services/location.service.js';
import { trainService } from '../services/train.service.js';

export async function handleStart(ctx: Context) {
  if (!ctx.from) return;
  
  console.log(`👤 User ${ctx.from.id} started bot`);
  
  await userQueries.createUser(
    ctx.from.id,
    ctx.from.first_name,
    ctx.from.username
  );

  await ctx.reply(
    `👋 Welcome to WakeMe Travel, ${ctx.from.first_name}!\n\n` +
    `I'll make sure you never miss your stop again.\n\n` +
    `Where are you travelling today?`,
    keyboards.main
  );
  
  console.log('✅ Sent keyboard to user');
}

export async function handleStatus(ctx: Context) {
  if (!ctx.from) return;
  
  const trip = await tripQueries.getActiveTrip(ctx.from.id);

  if (!trip) {
    await ctx.reply('📊 No active trips\n\nStart new journey:', keyboards.main);
    return;
  }

  // Bus status
  if (trip.type === 'bus' && trip.current_lat && trip.destination_lat) {
    const distance = locationService.calculateDistance(
      trip.current_lat,
      trip.current_lng!,
      trip.destination_lat,
      trip.destination_lng!
    );
    //@ts-ignore
    const lastUpdate = new Date(trip.updated_at);
    const minutesAgo = Math.floor((Date.now() - lastUpdate.getTime()) / (1000 * 60));
    
    await ctx.reply(
      `📊 *Bus Journey Status*\n\n` +
      `📍 Destination: ${trip.to_location}\n` +
      `📏 Distance: ${distance.toFixed(1)} km\n` +
      `⏱️ ETA: ~${Math.round(distance/40*60)} mins\n` +
      `🔄 Last update: ${minutesAgo} min(s) ago\n\n` +
      `${minutesAgo > 5 ? '⚠️ Location update delayed!' : '✅ Tracking active'}`,
      { parse_mode: 'Markdown' }
    );
  } 
  // Train status with live tracking
  else if (trip.type === 'train' && trip.train_number && trip.departure_time) {
    await ctx.reply('🔍 Fetching live train status...');
    
    const journeyDate = trainService.formatDateForAPI(new Date(trip.departure_time));
    const liveStatus = await trainService.getLiveTrainStatus(
      trip.train_number,
      journeyDate,
      trip.to_location!
    );

    if (liveStatus) {
      const etaMinutes = Math.round((liveStatus.distanceRemaining / 60) * 60);
      
      let statusText = `📊 *Train Journey Status*\n\n` +
        `🚆 ${trip.train_name} (${trip.train_number})\n` +
        `📍 Current: ${liveStatus.currentStation}\n` +
        `⏭️ Next: ${liveStatus.nextStation}\n` +
        `🎯 Destination: ${trip.to_location}\n\n` +
        `📊 Progress:\n` +
        `  • ${liveStatus.stationsRemaining} station(s) remaining\n` +
        `  • ~${liveStatus.distanceRemaining} km to go\n` +
        `  • ETA: ~${etaMinutes} mins\n` +
        `  • Delay: ${liveStatus.delayMinutes > 0 ? `+${liveStatus.delayMinutes}` : '0'} mins\n\n`;
      
      if (liveStatus.upcomingStations.length > 0) {
        statusText += `📋 Next 3 Stations:\n`;
        liveStatus.upcomingStations.slice(0, 3).forEach(station => {
          statusText += `  • ${station.station} - ${station.arr}\n`;
        });
      }

      await ctx.reply(statusText, { parse_mode: 'Markdown' });
    } else {
      const depTime = new Date(trip.departure_time!);
      const arrTime = new Date(trip.arrival_time!);
      
      await ctx.reply(
        `📊 *Train Journey Status*\n\n` +
        `🚆 ${trip.train_name} (${trip.train_number})\n` +
        `📍 ${trip.from_location} → ${trip.to_location}\n` +
        `🕐 Departure: ${depTime.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}\n` +
        `🏁 Arrival: ${arrTime.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}\n\n` +
        `⚠️ Live tracking unavailable (train not started or API error)`,
        { parse_mode: 'Markdown' }
      );
    }
  } else {
    await ctx.reply(formatTripStatus(trip), { parse_mode: 'Markdown' });
  }
}

export async function handleCancel(ctx: Context) {
  if (!ctx.from) return;
  
  await tripQueries.cancelTrip(ctx.from.id);
  await ctx.reply('❌ Alert cancelled\nJourney tracking stopped', keyboards.main);
}

export async function handleAwake(ctx: Context) {
  if (!ctx.from) return;
  
  const trip = await tripQueries.getActiveTrip(ctx.from.id);
  if (trip) {
    await tripQueries.markTripComplete(trip.id);
    await ctx.reply('✅ Great! Alert stopped.\nHave a safe journey! 🎉');
  } else {
    await ctx.reply('No active alert found.');
  }
}

export async function handleHelp(ctx: Context) {
  await ctx.reply(
    '🆘 *WakeMe Travel Help*\n\n' +
    '*Commands:*\n' +
    '/start - Start the bot\n' +
    '/status - Check active trip\n' +
    '/cancel - Cancel alert\n' +
    '/awake - Confirm you\'re awake\n' +
    '/help - Show this help\n' +
    // '/debug - Check your data (dev only)\n\n' +
    'Need help? Just ask!',
    { parse_mode: 'Markdown' }
  );
}

export async function handleDebug(ctx: Context) {
  if (!ctx.from) return;
  
  try {
    const user = await userQueries.getUser(ctx.from.id);
    const trip = await tripQueries.getActiveTrip(ctx.from.id);
    
    let debugInfo = `🔍 *Debug Info*\n\n`;
    debugInfo += `*User ID:* ${ctx.from.id}\n`;
    debugInfo += `*Username:* @${ctx.from.username || 'N/A'}\n`;
    debugInfo += `*Name:* ${ctx.from.first_name}\n\n`;
    
    if (user) {
      debugInfo += `*Phone in DB:* ${user.phone || 'Not saved'}\n`;
      debugInfo += `*Language:* ${user.language || 'en'}\n\n`;
    } else {
      debugInfo += `*User in DB:* ❌ Not found\n\n`;
    }
    
    if (trip) {
      debugInfo += `*Active Trip:*\n`;
      debugInfo += `- ID: ${trip.id}\n`;
      debugInfo += `- Type: ${trip.type}\n`;
      debugInfo += `- Status: ${trip.status}\n`;
      debugInfo += `- Destination: ${trip.to_location}\n`;
      debugInfo += `- Alert Time: ${trip.alert_time || 'Not set'}\n`;
    } else {
      debugInfo += `*Active Trip:* ❌ None\n`;
    }
    
    await ctx.reply(debugInfo, { parse_mode: 'Markdown' });
  } catch (error: any) {
    await ctx.reply(`❌ Debug error: ${error.message}`);
  }
}