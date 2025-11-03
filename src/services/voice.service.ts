import axios from 'axios';
import { config } from '../config/env.js';
import { callQueries } from '../database/queries.js';
import type { Trip } from '../types/index.js';

export class VoiceService {
  private apiKey: string;
  private baseUrl = 'https://api.vapi.ai';

  constructor() {
    this.apiKey = config.VAPI_API_KEY!;
    
    if (!this.apiKey) {
      throw new Error('VAPI_API_KEY not configured in .env');
    }
  }

  async makeWakeUpCall(trip: Trip, phone: string, attempt: number = 1): Promise<string | null> {
    try {
      console.log(`📞 Making VAPI call to ${phone} (Attempt ${attempt})`);
      
      const formattedPhone = this.formatPhoneNumber(phone);
      console.log(`📞 Formatted: ${formattedPhone}`);

      // CORRECT VAPI API CALL
      const response = await axios.post(
        `${this.baseUrl}/call`,  // ✅ Correct endpoint
        {
          // Phone number to call
          phoneNumberId: null, // null for outbound without owned number
          customer: {
            number: formattedPhone
          },

          // Assistant configuration (transient - not saved)
          assistant: {
            // First message
            firstMessage: this.getFirstMessage(trip, attempt),
            
            // Model config
            model: {
              provider: 'openai',
              model: 'gpt-4',
              messages: [
                {
                  role: 'system',
                  content: this.getSystemPrompt(trip, attempt)
                }
              ]
            },

            // Voice config
            voice: {
              provider: 'azure',
              voiceId: 'en-IN-NeerjaNeural' // Indian female
            },

            // End call settings
            endCallMessage: 'Have a safe journey! Goodbye.',
            endCallPhrases: [
              "i'm awake",
              "yes i'm up", 
              "i am awake",
              "okay i'm ready"
            ],

            // Call limits
            silenceTimeoutSeconds: 30,
            maxDurationSeconds: 180,

            // Transcriber
            transcriber: {
              provider: 'deepgram',
              model: 'nova-2',
              language: 'en-IN'
            },

            // ✅ CORRECT: Server URL configuration
            serverUrl: `${config.SERVER_URL}/vapi/server-messages`,
            
            // ✅ CORRECT: Server Messages to receive
            serverMessages: [
              'end-of-call-report',
              'transcript',
              'status-update'
            ]
          },

          // Metadata (passed to server URL)
          metadata: {
            trip_id: trip.id,
            attempt: attempt,
            destination: trip.to_location,
            user_telegram_id: trip.user_telegram_id
          }
        },
        {
          headers: {
            'Authorization': `Bearer ${this.apiKey}`,
            'Content-Type': 'application/json'
          }
        }
      );

      const callId = response.data.id;
      await callQueries.logCall(trip.id, callId, attempt, 'initiated');
      
      console.log(`✅ VAPI call created: ${callId}`);
      console.log(`   Status: ${response.data.status}`);
      
      return callId;

    } catch (error: any) {
      console.error('❌ VAPI call failed:');
      
      if (error.response) {
        console.error('Status:', error.response.status);
        console.error('Error:', JSON.stringify(error.response.data, null, 2));
      } else {
        console.error('Error:', error.message);
      }
      
      return null;
    }
  }

  private formatPhoneNumber(phone: string): string {
    let cleaned = phone.replace(/[\s\-\(\)]/g, '');
    
    if (cleaned.startsWith('+91')) return cleaned;
    if (cleaned.startsWith('91')) return '+' + cleaned;
    if (cleaned.length === 10) return '+91' + cleaned;
    
    return cleaned;
  }

  private getFirstMessage(trip: Trip, attempt: number): string {
    if (attempt === 1) {
      return `Hello! This is your WakeMe travel wake-up call. You are 30 minutes away from ${trip.to_location}. Are you awake?`;
    } else if (attempt === 2) {
      return `Wake up! This is your second call. You're approaching ${trip.to_location}. Please confirm you're awake!`;
    } else {
      return `URGENT! This is your final wake-up call! You will miss ${trip.to_location} if you don't wake up now!`;
    }
  }

  private getSystemPrompt(trip: Trip, attempt: number): string {
    const urgency = attempt === 1 ? 'friendly and calm' : 
                    attempt === 2 ? 'firm but polite' : 
                    'urgent and very insistent';

    return `You are a travel wake-up assistant. Your job is to wake up a traveler who is ${urgency}.

CONTEXT:
- Traveler destination: ${trip.to_location}
- Travel mode: ${trip.type}
- Distance remaining: 30 minutes
- Call attempt: ${attempt} of 5

YOUR MISSION:
Wake up the traveler and get CLEAR verbal confirmation they are awake. Be ${urgency}.

RULES:
1. Speak clearly in Indian English
2. Be ${urgency} but always polite
3. Don't hang up until you hear: "I'm awake", "Yes I'm up", or similar
4. If they mumble or say "hmm", that's NOT confirmation
5. Keep asking until you get clear confirmation
6. Provide helpful info: destination, arrival time
7. Maximum 2-3 minutes, then end
8. If user is angry, apologize and end

ACCEPTABLE CONFIRMATIONS:
- "I'm awake"
- "Yes, I'm up"
- "Okay, I'm ready"
- Clear, coherent speech confirming they're awake

NOT ACCEPTABLE:
- Mumbling, grunts, "hmm", "uh"
- Unclear sounds
- No response

HELPFUL PHRASES:
- "You'll reach ${trip.to_location} in 30 minutes"
- "I need to make sure you won't miss your stop"
- "Can you please say 'I'm awake' clearly?"
- "Are you sitting up? Good!"

END CALL WHEN:
- Clear confirmation received
- User gets angry (apologize first)
- 2-3 minutes passed

Speak naturally, be helpful, ensure they're truly awake before ending.`;
  }
}

export const voiceService = new VoiceService();