import { NextResponse } from 'next/server';
import { TAGS_VALIDAS } from '@/lib/tags';

// GET /api/tags-validas
// Retorna a taxonomia fixa de tags para o frontend popular dropdowns
// sem hardcodar a lista no client.
export async function GET() {
  return NextResponse.json({ tags: TAGS_VALIDAS });
}
