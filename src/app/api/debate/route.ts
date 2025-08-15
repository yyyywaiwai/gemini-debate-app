
import { GoogleGenerativeAI, HarmCategory, HarmBlockThreshold } from '@google/generative-ai';
import { NextResponse } from 'next/server';

const API_KEY = process.env.API_KEY;

if (!API_KEY) {
  throw new Error('API_KEY environment variable is required');
}
const genAI = new GoogleGenerativeAI(API_KEY);

const safetySettings = [
  { category: HarmCategory.HARM_CATEGORY_HARASSMENT, threshold: HarmBlockThreshold.BLOCK_NONE },
  { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH, threshold: HarmBlockThreshold.BLOCK_NONE },
  { category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT, threshold: HarmBlockThreshold.BLOCK_NONE },
  { category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: HarmBlockThreshold.BLOCK_NONE },
];

const MAX_RETRIES = 500;
const RETRY_DELAY = 50; // ms

export async function POST(request: Request) {
  const requestId = Math.random().toString(36).substr(2, 9);
  console.log(`[${requestId}] Starting debate request`);
  
  try {
    const { model, systemPrompt, history } = await request.json();
    
    // Log conversation history for debugging
    console.log(`[${requestId}] System Prompt: ${systemPrompt.substring(0, 100)}...`);
    console.log(`[${requestId}] Model: ${model}`);
    console.log(`[${requestId}] Conversation history (${history.length} messages):`);
    history.forEach((msg: {role: string, parts: {text: string}[]}, index: number) => {
      console.log(`[${requestId}] ${index}: role=${msg.role}, text=${msg.parts[0]?.text?.substring(0, 80)}...`);
    });
    
    // Validate first message is user
    if (history.length > 0 && history[0].role !== 'user') {
      console.error(`[${requestId}] ERROR: First message should be 'user', got '${history[0].role}'`);
      throw new Error(`First content should be with role 'user', got ${history[0].role}`);
    }

    if (!model || !systemPrompt || !history) {
      return NextResponse.json({ error: 'Missing required fields: model, systemPrompt, and history' }, { status: 400 });
    }

    const generativeModel = genAI.getGenerativeModel({
      model: model,
      systemInstruction: systemPrompt,
      safetySettings,
      generationConfig: { maxOutputTokens: 500000 },
    });

    const chat = generativeModel.startChat({ history });
    const lastMessage = history[history.length - 1]?.parts[0]?.text || '';

    let lastError: Error | null = null;
    for (let i = 0; i < MAX_RETRIES; i++) {
      try {
        const result = await chat.sendMessage(lastMessage);
        const response = result.response;
        const text = response.text();
        console.log(`[${requestId}] SUCCESS after ${i + 1} attempts. Response length: ${text.length}`);
        return NextResponse.json({ text, retries: i }); // Success, return immediately
      } catch (error) {
        lastError = error as Error;
        // Check if the error is the specific 403 forbidden error
        if (error instanceof Error && error.message.includes('403')) {
          console.log(`[${requestId}] Attempt ${i + 1} failed with 403 error. Retrying after ${RETRY_DELAY}ms...`);
          await new Promise(resolve => setTimeout(resolve, RETRY_DELAY));
        } else {
          // For other errors, don't retry
          throw error;
        }
      }
    }
    
    // If loop finishes, all retries have failed
    throw new Error(`Failed after ${MAX_RETRIES} retries. Last error: ${lastError?.message}`);

  } catch (error) {
    console.error(`[${requestId}] Error in debate API:`, error);
    const errorMessage = error instanceof Error ? error.message : 'An unknown error occurred';
    return NextResponse.json({ error: 'Failed to get response from AI', details: errorMessage }, { status: 500 });
  }
}
