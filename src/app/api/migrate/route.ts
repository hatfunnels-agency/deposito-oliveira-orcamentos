import { NextResponse } from 'next/server';

export async function GET() {
  try {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
    
    // Use Supabase's pg meta API to run SQL
    const pgMetaUrl = supabaseUrl.replace('.supabase.co', '.supabase.co') + '/rest/v1/rpc/exec_sql';
    
    // Alternative: use the Postgres extension via supabase REST directly
    // Run ALTER TABLE via supabase database API
    const res = await fetch(`${supabaseUrl}/rest/v1/`, {
      method: 'GET',
      headers: {
        'apikey': serviceKey,
        'Authorization': `Bearer ${serviceKey}`,
      },
      cache: 'no-store',
    });
    
    // Try using pg_meta via supabase project reference
    const projectRef = supabaseUrl.replace('https://', '').replace('.supabase.co', '');
    const sqlRes = await fetch(`https://api.supabase.com/v1/projects/${projectRef}/database/query`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${serviceKey}`,
      },
      body: JSON.stringify({ query: 'ALTER TABLE orcamentos ADD COLUMN IF NOT EXISTS status_pagamento TEXT DEFAULT \'pendente\';' }),
      cache: 'no-store',
    });
    
    const sqlData = await sqlRes.text();
    return NextResponse.json({ 
      projectRef, 
      sqlStatus: sqlRes.status,
      sqlResponse: sqlData.substring(0, 500),
    });
  } catch (e) {
    return NextResponse.json({ error: String(e) });
  }
}
