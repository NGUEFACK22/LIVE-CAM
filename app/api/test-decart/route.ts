// app/api/test-decart/route.ts
import { NextResponse } from "next/server";
import { createDecartClient } from "@decartai/sdk";
import { resolveDecartKeys } from '@/lib/decart-config'

// Force Node.js (important sur Vercel)
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  // Resoudre la cle Decart : Supabase d'abord, .env en fallback
  const { apiKey, source } = await resolveDecartKeys()

  console.log("=== DEBUG DECART ===");
  console.log("Source de la cle :", source);
  console.log("Clé présente ?", !!apiKey);
  console.log("Longueur de la clé :", apiKey?.length || 0);
  console.log("Préfixe :", apiKey?.substring(0, 10));

  if (!apiKey) {
    return NextResponse.json({
      error: "Decart API key not configured",
      message: "Vérifie tes variables d'environnement sur Vercel ou la table app_config dans Supabase",
      source,
    }, { status: 500 });
  }

  try {
    // Test simple de création de client
    const client = createDecartClient({ apiKey });

    return NextResponse.json({
      success: true,
      message: "Clé Decart chargée avec succès ✅",
      keyLength: apiKey.length,
      keyPrefix: apiKey.substring(0, 15) + "...",
      source,
      status: "OK"
    });
  } catch (error: any) {
    return NextResponse.json({
      error: "Erreur lors de la création du client",
      details: error.message,
      source,
    }, { status: 500 });
  }
}
