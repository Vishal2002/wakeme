// test-bland-call.ts - FULLY FIXED PER BLAND.AI DOCS
// Endpoint: /v1/calls, auth: 'authorization: <key>', params: phone_number, task, webhook
// Response: call_id (not id), max_duration in minutes
import axios from 'axios';
import dotenv from 'dotenv';
dotenv.config();


const apiKey = process.env.BLAND_API_KEY || 'your_bland_api_key_here';  // Set your key here or in .env
const phoneNumber = '+916354770065';  // Your test number (E.164: +91 + 10 digits)
const webhookUrl = process.env.SERVER_URL ? `${process.env.SERVER_URL}/bland/webhook` : null;  // Optional webhook

async function testBlandCall() {
  const url = 'https://api.bland.ai/v1/calls';

  const options = {
    method: 'POST',
    headers: {
      'authorization': apiKey,  // Raw API key (e.g., 'key-v1-abc123...' or 'org-...')
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      phone_number: phoneNumber,  // Required: Target phone number
      task: `You are a friendly wake-up assistant for a travel app. 
Call the user to wake them for their bus/train stop. 
Start with: "Hello! This is WakeMe. You're 30 minutes from your destination. Are you awake? Please say 'I'm awake' clearly."
Keep asking politely until they say "I'm awake", "Yes I'm up", or "Okay ready". 
Ignore mumbles, "hmm", or silence—gently repeat the request.
If frustrated, apologize and end: "Sorry for the disturbance—safe travels!"
Speak in clear, neutral Indian English (en-IN). Keep responses short (10-15s).`,  // Required: AI instructions/prompt
      first_sentence: 'Hello! Test wake-up call from WakeMe. Can you hear me?',  // Optional: Opening line
      voice: 'Josh',  // Optional: Voice (e.g., 'maya' for female, natural)
      language: 'en-IN',  // Optional: Language/accent
      max_duration: 3,  // Optional: Max minutes (default 30)
      ...(webhookUrl && { webhook: webhookUrl }),  // Optional: HTTPS webhook for transcripts/events
      metadata: { test: true, phone: phoneNumber },  // Optional: Data for webhook
      wait_for_greeting: false,  // Optional: AI speaks first
      temperature: 0.7,  // Optional: AI randomness (0-2)
      // Optional: Voicemail config
      voicemail: {
        action: 'leave_message',  // 'leave_message', 'hangup', or 'ignore'
        message: 'Hi, this is WakeMe. Wake up for your trip—we\'ll try again soon.',
      },
      // Optional: Retry on fail/voicemail
      retry: {
        wait: 120,  // Seconds before retry
        voicemail_action: 'leave_message',
      },
    }),
  };

  try {
    console.log('🧪 Sending request to Bland.ai...');
    const response = await fetch(url, options);

    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(`API Error ${response.status}: ${JSON.stringify(errorData, null, 2)}`);
    }

    const data = await response.json();
    console.log('✅ Call queued successfully!');
    console.log('Call ID:', data.call_id);
    console.log('Status:', data.status || 'queued');
    console.log('Batch ID:', data.batch_id || 'N/A');
    console.log('Full Response:', JSON.stringify(data, null, 2));
    console.log('\n📞 Expect the call in 5-15 seconds!');
    console.log('   - Answer and say "I\'m awake" to test confirmation.');
    console.log('   - Check transcripts in dashboard: https://app.bland.ai/calls');
    console.log('   - If webhook set, monitor server logs for events.');
  } catch (error:any) {
    console.error('❌ Test failed:', error.message);
    // Common troubleshooting
    if (error.message.includes('403')) {
      console.error('\n🔒 403 FIX:');
      console.error('  - Regenerate API key at app.bland.ai/settings/api-keys.');
      console.error('  - Add $5+ credits at app.bland.ai/billing (trial limit).');
      console.error('  - Email hello@bland.ai if flagged ("403 error on new account").');
    } else if (error.message.includes('401')) {
      console.error('\n🔑 401 FIX: Invalid key. Copy exact from dashboard (e.g., "key-v1-...").');
    } else if (error.message.includes('402')) {
      console.error('\n💳 402 FIX: No credits. Fund account.');
    } else if (error.message.includes('400')) {
      console.error('\n📱 400 FIX: Check phone_number (+91XXXXXXXXXX), task <2000 chars.');
    } else if (error.message.includes('429')) {
      console.error('\n⏳ 429 FIX: Rate limit—wait 30s, retry.');
    }
  }
}

testBlandCall();