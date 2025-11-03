import axios from 'axios';
import dotenv from 'dotenv';

dotenv.config();

async function testVapiCall() {
  try {
    console.log('🧪 Testing VAPI call with correct API...\n');
    
    const response = await axios.post(
      'https://api.vapi.ai/call',  // ✅ Correct endpoint
      {
        phoneNumberId: null,
        customer: {
          number: '+919099722911' // YOUR TEST NUMBER
        },
        assistant: {
          firstMessage: 'Hello! This is a test call from WakeMe. Can you hear me clearly?',
          
          model: {
            provider: 'openai',
            model: 'gpt-4',
            messages: [{
              role: 'system',
              content: 'You are a test assistant. Ask if the user can hear you, then end the call.'
            }]
          },
          
          voice: {
            provider: 'azure',
            voiceId: 'en-IN-NeerjaNeural'
          },
          
          endCallMessage: 'Test complete. Goodbye!',
          maxDurationSeconds: 60,
          
          serverUrl: `${process.env.SERVER_URL}/vapi/server-messages`,
          serverMessages: ['end-of-call-report']
        },
        
        metadata: {
          test: true
        }
      },
      {
        headers: {
          'Authorization': `Bearer ${process.env.VAPI_API_KEY}`,
          'Content-Type': 'application/json'
        }
      }
    );
    
    console.log('✅ Call initiated successfully!');
    console.log('   Call ID:', response.data.id);
    console.log('   Status:', response.data.status);
    console.log('\n📞 You should receive a call in 5-15 seconds...');
    console.log('   Check server logs for end-of-call-report\n');
    
  } catch (error: any) {
    console.error('❌ Test failed!');
    
    if (error.response) {
      console.error('Status:', error.response.status);
      console.error('Error:', JSON.stringify(error.response.data, null, 2));
    } else {
      console.error('Error:', error.message);
    }
  }
}

testVapiCall();