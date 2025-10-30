import axios from 'axios';
import { config } from '../config/env.js';
import { callQueries } from '../database/queries.js';
import type { Trip } from '../types/index.js';

export class VoiceService {
  private apiKey: string;
  private service: 'bland' | 'vapi';

  constructor() {
    this.service = config.VOICE_SERVICE as 'bland' | 'vapi';
    this.apiKey = this.service === 'bland' 
      ? config.BLAND_API_KEY! 
      : config.VAPI_API_KEY!;
  }

  async makeWakeUpCall(trip: Trip, phone: string, attempt: number = 1): Promise<string | null> {
    if (this.service === 'bland') {
      return this.makeBlandCall(trip, phone, attempt);
    } else {
      return this.makeVapiCall(trip, phone, attempt);
    }
  }

  private async makeBlandCall(trip: Trip, phone: string, attempt: number): Promise<string | null> {
    try {
      const urgency = attempt === 1 ? 'friendly' : attempt === 2 ? 'firm' : 'urgent';
      
      const response = await axios.post(
        'https://api.bland.ai/v1/calls',
        {
          phone_number: phone,
          
          task: this.generateTaskPrompt(trip, urgency),
          
          voice: 'maya', // Indian English female voice
          
          first_sentence: this.getFirstSentence(trip, urgency),
          
          model: 'enhanced',
          max_duration: 3,
          wait_for_greeting: false,
          record: true,
          
          webhook: `${config.SERVER_URL}/webhooks/call-complete`,
          
          metadata: {
            trip_id: trip.id,
            attempt: attempt
          }
        },
        {
          headers: {
            'Authorization': `Bearer ${this.apiKey}`,
            'Content-Type': 'application/json'
          }
        }
      );

      const callId = response.data.call_id;
      await callQueries.logCall(trip.id, callId, attempt, 'initiated');
      
      console.log(`✅ Bland.ai call initiated: ${callId}`);
      return callId;

    } catch (error) {
      console.error('❌ Bland.ai call failed:', error);
      return null;
    }
  }

  private async makeVapiCall(trip: Trip, phone: string, attempt: number): Promise<string | null> {
    try {
      const response = await axios.post(
        'https://api.vapi.ai/call/phone',
        {
          phoneNumber: phone,
          
          assistant: {
            firstMessage: this.getFirstSentence(trip, attempt === 1 ? 'friendly' : 'urgent'),
            model: {
              provider: 'openai',
              model: 'gpt-4',
              messages: [
                {
                  role: 'system',
                  content: this.generateTaskPrompt(trip, attempt === 1 ? 'friendly' : 'urgent')
                }
              ]
            },
            voice: {
              provider: '11labs',
              voiceId: 'pNInz6obpgDQGcFmaJgB' // Indian English
            }
          },
          
          metadata: {
            trip_id: trip.id,
            attempt: attempt
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
      
      console.log(`✅ Vapi call initiated: ${callId}`);
      return callId;

    } catch (error) {
      console.error('❌ Vapi call failed:', error);
      return null;
    }
  }

  private generateTaskPrompt(trip: Trip, urgency: string): string {
    const urgencyMap = {
      friendly: 'in a calm, friendly manner',
      firm: 'in a firm but polite manner',
      urgent: 'with urgency and insistence'
    } as const;
    const tone = urgencyMap[urgency as keyof typeof urgencyMap] || urgencyMap.friendly;

    return `You are a travel wake-up assistant. Your job is to wake up ${trip.id || 'the traveler'} ${tone}.

CONTEXT:
- Destination: ${trip.to_location}
- Type: ${trip.type}
- Time: 30 minutes before arrival

YOUR MISSION:
Wake up the traveler and get CLEAR CONFIRMATION they are awake.

RULES:
1. Be ${urgency === 'urgent' ? 'VERY LOUD AND PERSISTENT' : urgency === 'firm' ? 'firm and clear' : 'friendly but clear'}
2. Don't hang up until they CLEARLY say "I'm awake" or similar
3. If they sound sleepy/groggy, keep insisting
4. Provide helpful info: arrival time, destination
5. Maximum 2 minutes - if no clear response, end and retry

ACCEPTABLE CONFIRMATIONS:
- "Yes, I'm awake"
- "I'm up"
- "Okay, I'm ready"
- Clear, coherent speech

NOT ACCEPTABLE:
- Mumbling, grunts
- "Hmm", "Uh"
- Unclear sounds

END CALL WHEN:
- Clear confirmation received
- User gets angry (apologize and end)
- 2 minutes passed

If ${trip.type === 'train'}: Mention the train ${trip.train_name || ''} arriving at ${trip.to_location}
If ${trip.type === 'bus'}: Mention you're 30 minutes from ${trip.to_location}`;
  }

  private getFirstSentence(trip: Trip, urgency: string): string {
    if (urgency === 'urgent') {
      return `URGENT WAKE UP CALL! You are about to miss your stop at ${trip.to_location}! Wake up now!`;
    } else if (urgency === 'firm') {
      return `This is your second wake-up call! You are approaching ${trip.to_location}. Please wake up!`;
    } else {
      return `Good morning! This is your wake-up call. You're 30 minutes away from ${trip.to_location}. Are you awake?`;
    }
  }
}

export const voiceService = new VoiceService();
