
import { GoogleGenerativeAI, HarmCategory, HarmBlockThreshold } from '@google/generative-ai';
import { NextResponse } from 'next/server';

const API_KEY = process.env.API_KEY || 'AIzaSyDgT2iynBTPbyavRAtgAf1F4tPP_Gc87xE';
const genAI = new GoogleGenerativeAI(API_KEY);

const safetySettings = [
  { category: HarmCategory.HARM_CATEGORY_HARASSMENT, threshold: HarmBlockThreshold.BLOCK_NONE },
  { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH, threshold: HarmBlockThreshold.BLOCK_NONE },
  { category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT, threshold: HarmBlockThreshold.BLOCK_NONE },
  { category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: HarmBlockThreshold.BLOCK_NONE },
];

const MAX_RETRIES = 40;
const RETRY_DELAY = 500; // ms

export async function POST(request: Request) {
  try {
    const { model, systemPrompt, history } = await request.json();

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
        return NextResponse.json({ text, retries: i }); // Success, return immediately
      } catch (error) {
        lastError = error as Error;
        // Check if the error is the specific 403 forbidden error
        if (error instanceof Error && error.message.includes('403')) {
          console.log(`Attempt ${i + 1} failed with 403 error. Retrying after ${RETRY_DELAY}ms...`);
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
    console.error('Error in debate API:', error);
    const errorMessage = error instanceof Error ? error.message : 'An unknown error occurred';
    return NextResponse.json({ error: 'Failed to get response from AI', details: errorMessage }, { status: 500 });
  }
}
