import { Context } from 'telegraf';
import { userQueries, tripQueries } from '../database/queries.js';
import { keyboards } from '../services/telegram.service.js';

export async function handleConfirmTrain(ctx: Context) {
  if (!ctx.from || !ctx.callbackQuery) return;
  
  const trip = await tripQueries.getActiveTrip(ctx.from.id);
  if (!trip) return;

  await tripQueries.updateTripStatus(trip.id, 'awaiting_phone');

  const user = await userQueries.getUser(ctx.from.id);
  
  if (!user?.phone) {
    await ctx.editMessageText(
      '📞 *Phone Number Required*\n\n' +
      'I need your phone number to make wake-up calls.',
      { parse_mode: 'Markdown' }
    );
    
    await ctx.reply('Share your phone:', keyboards.shareContact);
  } else {
    await tripQueries.updateTripStatus(trip.id, 'active');
    const alertTime = new Date(trip.alert_time!);
    
    await ctx.editMessageText(
      `Perfect! ✅\n\n` +
      `⏰ I'll call you at ${alertTime.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })} (30 mins before)\n` +
      `📞 ${user.phone}\n\n` +
      `🔔 Alert set!\nSleep well 😴`
    );
  }
  
  await ctx.answerCbQuery();
}

export async function handleCancelTrain(ctx: Context) {
  if (!ctx.from || !ctx.callbackQuery) return;
  
  await tripQueries.cancelTrip(ctx.from.id);
  await ctx.editMessageText('Trip cancelled. Send new PNR to try again.');
  await ctx.answerCbQuery();
}
