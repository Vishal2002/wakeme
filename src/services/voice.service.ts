import axios from 'axios';
import { config } from '../config/env.js';
import { callQueries } from '../database/queries.js';
import { bot } from './telegram.service.js';
import type { Trip } from '../types/index.js';

export class VoiceService {
  private readonly apiUrl = 'https://api.bland.ai/v1/calls';

  constructor() {
    if (!config.BLAND_API_KEY) {
      throw new Error('BLAND_API_KEY required in .env. Get it from: https://app.bland.ai/settings/api-keys');
    }
    console.log('✅ Bland.ai voice service initialized');
  }

  /**
   * Make a wake-up call using Bland.ai
   * @param trip - Trip object with user phone number
   * @param attempt - Call attempt number (1-5)
   * @returns Call ID if successful, null if failed
   */
  async makeWakeUpCall(trip: Trip & { phone: string }, attempt: number = 1): Promise<string | null> {
    try {
      console.log(`📞 [Attempt ${attempt}/5] Queuing Bland.ai call to ${trip.phone}`);
      console.log(`   Trip: ${trip.type} to ${trip.to_location}`);

      const formattedPhone = this.formatPhoneNumber(trip.phone);

      const response = await axios.post(
        this.apiUrl,
        {
          // Required fields
          phone_number: formattedPhone,
          task: this.generatePrompt(trip, attempt),
          
          // Call configuration
          first_sentence: this.getFirstMessage(trip, attempt),
          voice: 'maya', // Indian English female voice
          language: 'en-IN', // Indian English accent
          max_duration: 3, // 3 minutes maximum
          
          // Webhook for call completion events
          webhook: `${config.SERVER_URL}/bland/webhook`,
          
          // Metadata (returned in webhook)
          metadata: {
            trip_id: trip.id,
            user_telegram_id: trip.user_telegram_id,
            attempt: attempt,
            destination: trip.to_location,
            type: trip.type,
            timestamp: new Date().toISOString()
          },
          
          // Call behavior
          wait_for_greeting: false, // AI speaks first
          temperature: 0.7, // Balanced creativity
          interruption_threshold: 100, // Default responsiveness
          
          // Voicemail handling
          voicemail: {
            action: 'leave_message',
            message: `Hi, this is WakeMe. You're approaching ${trip.to_location}. Please wake up! We'll call again soon.`
          },
          
          // Retry configuration (optional - Bland.ai will retry automatically)
          retry: {
            wait: 120, // Wait 2 minutes before retry
            voicemail_action: 'leave_message'
          }
        },
        {
          headers: {
            'authorization': config.BLAND_API_KEY,
            'Content-Type': 'application/json'
          }
        }
      );

      const callId = response.data.call_id;
      
      // Log call to database
      await callQueries.logCall(trip.id, callId, attempt, 'queued');

      console.log(`✅ Call queued successfully: ${callId}`);
      if (response.data.batch_id) {
        console.log(`   Batch ID: ${response.data.batch_id}`);
      }

      // Notify user via Telegram
      await bot.telegram.sendMessage(
        trip.user_telegram_id,
        `📞 Wake-up call queued! (Attempt ${attempt}/5)\n` +
        `📍 ~30 minutes to ${trip.to_location}\n` +
        `Answer and say "I'm awake" clearly.`
      );

      return callId;

    } catch (error: any) {
      console.error('❌ Bland.ai call failed:');
      
      if (error.response) {
        const status = error.response.status;
        const data = error.response.data;
        
        console.error(`   Status: ${status}`);
        console.error(`   Message: ${data?.message || 'Unknown error'}`);
        
        if (data?.errors) {
          console.error(`   Errors: ${JSON.stringify(data.errors, null, 2)}`);
        }

        // User-friendly error messages
        switch (status) {
          case 400:
            console.error('   💡 Fix: Check phone number format (+91XXXXXXXXXX) and task length');
            break;
          case 401:
            console.error('   💡 Fix: Invalid API key. Check BLAND_API_KEY in .env');
            break;
          case 402:
            console.error('   💡 Fix: Insufficient credits. Add funds at https://app.bland.ai/billing');
            break;
          case 403:
            console.error('   💡 Fix: Account suspended or verification needed');
            break;
          case 429:
            console.error('   💡 Fix: Rate limited. Wait 30 seconds and try again');
            break;
        }
      } else {
        console.error(`   Error: ${error.message}`);
      }

      // Notify user of failure
      try {
        await bot.telegram.sendMessage(
          trip.user_telegram_id,
          `⚠️ Call attempt ${attempt} failed. Retrying in 2 minutes...`
        );
      } catch (notifyError) {
        console.error('   Failed to notify user:', notifyError);
      }

      return null;
    }
  }

  /**
   * Get the opening message based on attempt number
   */
  private getFirstMessage(trip: Trip, attempt: number): string {
    if (attempt === 1) {
      return `Hello! This is WakeMe. Your ${trip.type} to ${trip.to_location} arrives in 30 minutes. Are you awake? Please say "I'm awake" clearly.`;
    } else if (attempt === 2) {
      return `Wake up! This is your second call from WakeMe. You're approaching ${trip.to_location}. Please confirm you're awake by saying "I'm awake".`;
    } else {
      return `URGENT! This is attempt ${attempt} from WakeMe. You will miss ${trip.to_location} if you don't wake up now! Say "I'm awake" immediately!`;
    }
  }

  /**
   * Generate AI prompt with context and instructions
   */
  private generatePrompt(trip: Trip, attempt: number): string {
    const urgency = attempt === 1 ? 'friendly and gentle' : 
                    attempt === 2 ? 'firm and encouraging' : 
                    'urgent but polite';

    return `You are WakeMe, a helpful travel wake-up assistant. Your mission is to wake a sleeping traveler to ensure they don't miss their destination.

CONTEXT:
- Destination: ${trip.to_location}
- Travel mode: ${trip.type} (bus or train)
- Time remaining: 30 minutes
- Call attempt: ${attempt} of 5
- Urgency level: ${urgency}

YOUR INSTRUCTIONS:
1. Start with the provided first_sentence
2. Speak slowly and clearly in neutral Indian English (en-IN accent)
3. Your ONLY goal: Get explicit verbal confirmation they are FULLY AWAKE
4. Keep responses short (10-15 seconds each)
5. Be ${urgency} in tone but always respectful

CONFIRMATION LOOP:
- If you hear: "I'm awake", "Yes I'm up", "Okay ready", "I am awake" → END CALL immediately
- If you hear: mumbling, "hmm", "uh", unclear sounds, or silence → Say: "Sorry, I didn't hear clearly. Please say 'I'm awake' now."
- Keep asking politely until you get CLEAR confirmation
- After 3 unclear responses, say: "I'll call back in 2 minutes" → END CALL

HELPFUL TIPS TO PROVIDE:
- "You'll reach ${trip.to_location} in about 30 minutes"
- "Please gather your belongings"
- "Check for your stop announcement"
- "Make sure you're sitting up"

ESCALATION (if attempt > 2):
- Add urgency: "This is very important - you might miss your stop!"
- Be more insistent but still polite

END CALL WHEN:
- User clearly says "I'm awake" or similar (✅ Success)
- User becomes angry or frustrated (apologize and end)
- Maximum duration reached (3 minutes)
- User explicitly asks to end call

NEVER:
- Don't discuss other topics
- Don't give medical advice
- Don't make assumptions about why they're sleeping
- Don't be rude or aggressive even if frustrated

Remember: You're like a caring friend ensuring someone wakes up for an important journey. Be persistent but kind!`;
  }

  /**
   * Format and validate phone number
   * Ensures E.164 format: +91XXXXXXXXXX
   */
  private formatPhoneNumber(phone: string): string {
    // Remove all formatting characters
    let cleaned = phone.replace(/[\s\-\(\)\+]/g, '');
    
    // If 10 digits, add +91
    if (cleaned.length === 10 && /^\d{10}$/.test(cleaned)) {
      return '+91' + cleaned;
    }
    
    // If starts with 91 and is 12 digits, add +
    if (cleaned.startsWith('91') && cleaned.length === 12) {
      return '+' + cleaned;
    }
    
    // Already formatted correctly
    if (cleaned.startsWith('+91') && cleaned.length === 13) {
      return cleaned;
    }
    
    // Invalid format
    throw new Error(`Invalid phone number: ${phone}. Expected format: +91XXXXXXXXXX (10 digits after +91)`);
  }

  /**
   * Get call status from Bland.ai (for debugging)
   */
  async getCallStatus(callId: string): Promise<any> {
    try {
      const response = await axios.get(
        `https://api.bland.ai/v1/calls/${callId}`,
        {
          headers: {
            'authorization': config.BLAND_API_KEY
          }
        }
      );
      return response.data;
    } catch (error: any) {
      console.error('Failed to get call status:', error.message);
      return null;
    }
  }
}

export const voiceService = new VoiceService();