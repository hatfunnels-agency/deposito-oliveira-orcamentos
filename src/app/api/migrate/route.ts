import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

export async function GET() {
  try {
    const { error } = await supabaseAdmin.rpc('exec_sql', {
      sql: 'ALTER TABLE orcamentos ADD COLUMN IF NOT EXISTS status_pagamento TEXT DEFAULT \'pendente\';'
    });
    if (error) {
      // Try direct query via postgrest
      const { error: e2 } = await (supabaseAdmin as any).from('orcamentos').select('status_pagamento').limit(1);
      return NextResponse.json({ rpc_error: error.message, check: e2?.message || 'column may already exist' });
    }
    return NextResponse.json({ success: true, message: 'Column status_pagamento created' });
  } catch (e) {
    return NextResponse.json({ error: String(e) });
  }
}
