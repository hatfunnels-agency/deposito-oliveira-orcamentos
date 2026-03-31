import { NextResponse } from 'next/server';

export async function GET() {
  try {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
    const projectRef = supabaseUrl.replace('https://', '').replace('.supabase.co', '');
    
    // Use Supabase's pg-meta internal API (available via REST)
    // This endpoint accepts the service role key
    const sql = 'ALTER TABLE orcamentos ADD COLUMN IF NOT EXISTS status_pagamento TEXT DEFAULT \'pendente\'';
    
    // Method: Use the undocumented but working pg endpoint
    const res = await fetch(`${supabaseUrl}/rest/v1/rpc/query`, {
      method: 'POST', 
      headers: {
        'Content-Type': 'application/json',
        'apikey': serviceKey,
        'Authorization': `Bearer ${serviceKey}`,
      },
      body: JSON.stringify({ query: sql }),
      cache: 'no-store',
    });
    const d1 = await res.text();
    
    // Method 2: direct pg via supabase internal
    const res2 = await fetch(`https://${projectRef}.supabase.co/pg/query`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json', 
        'apikey': serviceKey,
        'Authorization': `Bearer ${serviceKey}`,
      },
      body: JSON.stringify({ query: sql }),
      cache: 'no-store',
    });
    const d2 = await res2.text();
    
    return NextResponse.json({ 
      projectRef,
      method1: { status: res.status, body: d1.substring(0, 200) },
      method2: { status: res2.status, body: d2.substring(0, 200) },
    });
  } catch (e) {
    return NextResponse.json({ error: String(e) });
  }
}
