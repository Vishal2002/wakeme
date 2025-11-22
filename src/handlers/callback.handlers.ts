import { Context } from 'telegraf';
import { userQueries, tripQueries } from '../database/queries.js';
import { keyboards } from '../services/telegram.service.js';

export async function handleConfirmTrain(ctx: Context) {
  if (!ctx.from) return;
  
  const trip = await tripQueries.getActiveTrip(ctx.from.id);
  
  if (!trip) {
    await ctx.answerCbQuery('No active trip found');
    return;
  }

  const user = await userQueries.getUser(ctx.from.id);
  
  if (!user || !user.phone) {
    await tripQueries.updateTripStatus(trip.id, 'awaiting_phone');
    
    await ctx.reply(
      '📞 *Phone Number Required*\n\n' +
      'I need your phone number to make wake-up calls.\n\n' +
      'Tap the button below to share:',
      { parse_mode: 'Markdown', ...keyboards.shareContact }
    );
    
    await ctx.answerCbQuery('Please share your phone number');
    return;
  }

  await tripQueries.updateTripStatus(trip.id, 'active');
  
  const depTime = new Date(trip.departure_time!);
  const arrTime = new Date(trip.arrival_time!);
  
  // Just send a new message instead of editing
  await ctx.reply(
    `✅ *Train Journey Active!*\n\n` +
    `🚆 ${trip.train_name} (${trip.train_number})\n` +
    `📍 ${trip.from_location} → ${trip.to_location}\n` +
    `🗓️ ${depTime.toLocaleDateString('en-IN')}\n` +
    `🕐 Departure: ${depTime.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}\n` +
    `🏁 Arrival: ${arrTime.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}\n\n` +
    `📞 ${user.phone}\n` +
    `⏰ I'll track your train and call when approaching.\n\n` +
    `Have a safe journey! 😴`,
    { parse_mode: 'Markdown', ...keyboards.main }
  );
  
  await ctx.answerCbQuery('✅ Confirmed!');
}

export async function handleCancelTrain(ctx: Context) {
  if (!ctx.from) return;
  
  await tripQueries.cancelTrip(ctx.from.id);
  
  await ctx.reply(
    '❌ Booking cancelled\n\nStart new journey:',
    keyboards.main
  );
  
  await ctx.answerCbQuery('Cancelled');
}