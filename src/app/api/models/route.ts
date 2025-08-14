import { NextResponse } from 'next/server';

// IMPORTANT: In a real-world application, you should never hardcode API keys.
// Use environment variables instead.
const API_KEY = 'AIzaSyDgT2iynBTPbyavRAtgAf1F4tPP_Gc87xE';

const GEMINI_API_URL = `https://generativelanguage.googleapis.com/v1beta/models?key=${API_KEY}`;

interface GeminiModel {
  name: string; // e.g., "models/gemini-pro"
  displayName: string;
  description: string;
  supportedGenerationMethods: string[];
}

export async function GET() {
  try {
    const response = await fetch(GEMINI_API_URL);
    if (!response.ok) {
      const errorBody = await response.text();
      console.error('Failed to fetch models from Gemini API:', errorBody);
      throw new Error(`Gemini API request failed with status ${response.status}`);
    }

    const data = await response.json();

    const filteredModels = data.models
      // Filter for models that can be used for chat/text generation
      .filter((model: GeminiModel) => 
        model.supportedGenerationMethods.includes('generateContent')
      )
      // Transform the data into the format the frontend expects { id, name }
      .map((model: GeminiModel) => ({
        // Extract the short name (e.g., "gemini-pro") from the full name ("models/gemini-pro")
        id: model.name.split('/').pop(),
        name: model.displayName,
      }))
      // Sort to show latest models first, if possible (simple alphabetical sort as a proxy)
      .sort((a: {id: string}, b: {id: string}) => b.id.localeCompare(a.id));

    if (!filteredModels || filteredModels.length === 0) {
      return NextResponse.json({ error: 'No compatible models available' }, { status: 404 });
    }

    return NextResponse.json({ models: filteredModels });

  } catch (error) {
    console.error('Error in /api/models:', error);
    const errorMessage = error instanceof Error ? error.message : 'An unknown error occurred';
    return NextResponse.json({ error: 'Failed to fetch models', details: errorMessage }, { status: 500 });
  }
}