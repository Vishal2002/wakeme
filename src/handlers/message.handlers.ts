import { Context } from 'telegraf';
import { message } from 'telegraf/filters';
import { userQueries, tripQueries } from '../database/queries.js';
import { trainService } from '../services/train.service.js';
import { keyboards } from '../services/telegram.service.js';
import { locationService } from '../services/location.service.js';

export async function handleBusButton(ctx: Context) {
  if (!ctx.from) return;
  
  console.log(`🚌 User ${ctx.from.id} started bus journey`);
  
  await tripQueries.createBusTrip(ctx.from.id);
  await ctx.reply(
    '🚌 *Bus Journey Setup*\n\n' +
    'Share your current location 📍\n' +
    '(Tap 📎 → Location)',
    { parse_mode: 'Markdown' }
  );
}

export async function handleTrainButton(ctx: Context) {
  console.log(`🚆 User ${ctx.from?.id} started train journey`);
  
  await ctx.reply(
    '🚆 *Train Journey Setup*\n\n' +
    'Send your PNR number\n(10 digits from your ticket)',
    { parse_mode: 'Markdown' }
  );
}

export async function handleLocation(ctx: Context) {
  
    if (!ctx.from || !ctx.message || !('location' in ctx.message)) return;
  
  const trip = await tripQueries.getActiveTrip(ctx.from.id);
  const location = ctx.message.location;

  console.log(`📍 Received location from user ${ctx.from.id}:`, location.latitude, location.longitude);

  if (!trip) {
    await ctx.reply('Please start a journey first using /start');
    return;
  }

  if (trip.status === 'pending_location') {
    await tripQueries.updateBusLocation(trip.id, location.latitude, location.longitude);
    console.log(`✅ Updated trip ${trip.id} with starting location`);
    
    await ctx.reply(
      '📍 Got your location!\n\n' +
      'Where are you going?\n' +
      '(Send destination name or share destination location)'
    );
  } else if (trip.status === 'awaiting_destination') {
    await tripQueries.setBusDestination(
      trip.id,
      'Your destination',
      location.latitude,
      location.longitude
    );
    console.log(`✅ Updated trip ${trip.id} with destination location`);
    
    await requestPhoneNumber(ctx, trip);
  }
}

export async function handleContact(ctx: Context) {
    if (!ctx.from || !ctx.message || !('contact' in ctx.message)) return;
  
  const contact = ctx.message.contact;
  
  console.log(`📞 Received contact from user ${ctx.from.id}:`, contact);

  // Check if user shared their own contact
  if (contact.user_id === ctx.from.id) {
    console.log(`✅ User ${ctx.from.id} shared their own contact: ${contact.phone_number}`);
    
    await userQueries.updateUserPhone(ctx.from.id, contact.phone_number);
    console.log(`✅ Saved phone number to database`);

    const trip = await tripQueries.getActiveTrip(ctx.from.id);

    if (trip && trip.status === 'awaiting_phone') {
      await tripQueries.updateTripStatus(trip.id, 'active');
      console.log(`✅ Activated trip ${trip.id}`);
      
      await ctx.reply(
        `✅ *All Set!*\n\n` +
        `🚌 ${trip.type === 'bus' ? 'Bus' : 'Train'} Journey Active\n` +
        `📍 Destination: ${trip.to_location}\n` +
        `⏰ I'll call you 30 mins before arrival\n` +
        `📞 ${contact.phone_number}\n\n` +
        `🟢 TRACKING STARTED\n\n` +
        `Have a safe journey! 😴`,
        { parse_mode: 'Markdown', ...keyboards.main }
      );
    } else {
      await ctx.reply('✅ Phone number saved!', keyboards.main);
    }
  } else {
    console.log(`❌ User ${ctx.from.id} shared someone else's contact`);
    await ctx.reply(
      '❌ Please share YOUR OWN contact number.\n' +
      'Tap the button below:',
      keyboards.shareContact
    );
  }
}

export async function handleText(ctx: Context) {
if (!ctx.from || !ctx.message || !('text' in ctx.message)) return;
  const text = ctx.message.text;
  const trip = await tripQueries.getActiveTrip(ctx.from.id);

  console.log(`💬 Text from user ${ctx.from.id}: "${text}"`);

  // Handle PNR
  if (/^\d{10}$/.test(text)) {
    console.log(`🚆 PNR detected: ${text}`);
    
    const trainData = await trainService.fetchTrainData(text);
    await tripQueries.createTrainTrip(ctx.from.id, text, trainData);

    const depTime = new Date(trainData.departure);
    const arrTime = new Date(trainData.arrival);

    await ctx.reply(
      `✅ *Found your ticket!*\n\n` +
      `🚆 ${trainData.train_name} (${trainData.train_number})\n` +
      `📍 ${trainData.from} → ${trainData.to}\n` +
      `🗓️ ${depTime.toLocaleDateString('en-IN')}, ${depTime.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}\n` +
      `🏁 Arrives: ${arrTime.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}\n\n` +
      `Is this correct?`,
      { parse_mode: 'Markdown', ...keyboards.confirmTrain }
    );
    return;
  }

  // Handle destination name
  // When user sends destination name
if (trip && trip.status === 'awaiting_destination') {
  console.log(`📍 Setting destination for trip ${trip.id}: ${text}`);
  
  // Get lat/lng from city name
  const location = await locationService.geocodeAddress(text);
  
  if (location) {
    await tripQueries.setBusDestination(
      trip.id, 
      text, 
      location.lat, 
      location.lng
    );
    console.log(`✅ Set destination: ${text} (${location.lat}, ${location.lng})`);
  } else {
    await tripQueries.setBusDestination(trip.id, text);
    console.log(`⚠️ Set destination without coordinates: ${text}`);
  }
  
  await requestPhoneNumber(ctx, trip);
  return;
}

  // Default response
  await ctx.reply(
    'I didn\'t understand that.\n\nUse the buttons below:',
    keyboards.main
  );
}

async function requestPhoneNumber(ctx: Context, trip: any) {
  if (!ctx.from) return;
  
  const user = await userQueries.getUser(ctx.from.id);
  
  console.log(`🔍 Checking if user ${ctx.from.id} has phone:`, user?.phone);
  
  if (!user || !user.phone) {
    console.log(`📞 Requesting phone number from user ${ctx.from.id}`);
    
    await ctx.reply(
      '📞 *Phone Number Required*\n\n' +
      'I need your phone number to make wake-up calls.\n\n' +
      'Tap the button below to share:',
      { parse_mode: 'Markdown', ...keyboards.shareContact }
    );
  } else {
    console.log(`✅ User already has phone: ${user.phone}`);
    
    await tripQueries.updateTripStatus(trip.id, 'active');
    
    await ctx.reply(
      `✅ *All Set!*\n\n` +
      `🚌 Bus Journey Active\n` +
      `📍 Destination: ${trip.to_location}\n` +
      `⏰ I'll call you 30 mins before arrival\n` +
      `📞 ${user.phone}\n\n` +
      `🟢 TRACKING STARTED\n\n` +
      `Have a safe journey! 😴`,
      { parse_mode: 'Markdown', ...keyboards.main }
    );
  }
}
