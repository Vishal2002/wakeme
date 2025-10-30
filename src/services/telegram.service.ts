import { Telegraf, Markup } from 'telegraf';
import { config } from '../config/env.js';

export const bot = new Telegraf(config.TELEGRAM_BOT_TOKEN);

export const keyboards = {
  main: Markup.keyboard([
    ['🚌 Bus', '🚆 Train'],
    ['📊 Status', '❌ Cancel']
  ]).resize(),

  shareContact: Markup.keyboard([
    Markup.button.contactRequest('📱 Share Phone Number')
  ]).resize().oneTime(),

  confirmTrain: Markup.inlineKeyboard([
    [
      Markup.button.callback('✅ YES', 'confirm_train'),
      Markup.button.callback('❌ NO', 'cancel_train')
    ]
  ]),
};

export function formatTripStatus(trip: any): string {
  if (trip.type === 'bus') {
    return `📊 *Active Trip*\n\n` +
           `🚌 Bus Journey\n` +
           `📍 Destination: ${trip.to_location}\n` +
           `🟢 Tracking Active\n` +
           `⏰ Alert when 30 mins away`;
  } else {
    const alertTime = new Date(trip.alert_time);
    return `📊 *Active Trip*\n\n` +
           `🚆 ${trip.train_name} (${trip.train_number})\n` +
           `📍 ${trip.from_location} → ${trip.to_location}\n` +
           `⏰ Alert at ${alertTime.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}`;
  }
}