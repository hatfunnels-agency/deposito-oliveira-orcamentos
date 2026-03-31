import { NextResponse } from 'next/server';

export async function GET() {
  try {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
    
    // Try Supabase pg-meta API with correct path
    const projectRef = supabaseUrl.replace('https://', '').replace('.supabase.co', '');
    
    const attempts = [];
    
    // Attempt 1: supabase pg meta API v1
    const r1 = await fetch(`https://${projectRef}.supabase.co/pg/query`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${serviceKey}` },
      body: JSON.stringify({ query: 'ALTER TABLE orcamentos ADD COLUMN IF NOT EXISTS status_pagamento TEXT DEFAULT \'pendente\'' }),
      cache: 'no-store',
    });
    attempts.push({ endpoint: 'pg/query', status: r1.status, body: (await r1.text()).substring(0,200) });

    // Attempt 2: supabase management API
    const r2 = await fetch(`https://api.supabase.com/v1/projects/${projectRef}/database/migrations`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${serviceKey}` },
      body: JSON.stringify({ name: 'add_status_pagamento', statements: ['ALTER TABLE orcamentos ADD COLUMN IF NOT EXISTS status_pagamento TEXT DEFAULT \'pendente\''] }),
      cache: 'no-store',
    });
    attempts.push({ endpoint: 'api.supabase.com/migrations', status: r2.status, body: (await r2.text()).substring(0,200) });

    // Attempt 3: Using the REST API with a raw header trick
    const r3 = await fetch(`${supabaseUrl}/rest/v1/orcamentos?select=status_pagamento&limit=1`, {
      headers: { 'apikey': serviceKey, 'Authorization': `Bearer ${serviceKey}` },
      cache: 'no-store',
    });
    attempts.push({ endpoint: 'select status_pagamento', status: r3.status, body: (await r3.text()).substring(0,200) });
    
    return NextResponse.json({ projectRef, attempts });
  } catch (e) {
    return NextResponse.json({ error: String(e) });
  }
}
