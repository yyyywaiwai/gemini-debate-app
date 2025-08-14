
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

    const result = await chat.sendMessage(lastMessage);
    const response = result.response;
    const text = response.text();

    return NextResponse.json({ text });

  } catch (error) {
    console.error('Error in debate API:', error);
    const errorMessage = error instanceof Error ? error.message : 'An unknown error occurred';
    return NextResponse.json({ error: 'Failed to get response from AI', details: errorMessage }, { status: 500 });
  }
}
