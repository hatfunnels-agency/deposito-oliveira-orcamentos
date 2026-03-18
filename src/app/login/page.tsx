'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { supabaseBrowser } from '@/lib/supabase-client';

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [senha, setSenha] = useState('');
  const [erro, setErro] = useState('');
  const [carregando, setCarregando] = useState(false);
  const router = useRouter();

  useEffect(() => {
    supabaseBrowser.auth.getSession().then(({ data: { session } }) => {
      if (session) router.push('/');
    });
  }, [router]);

  const handleLogin = async (e) => {
    e.preventDefault();
    setErro('');
    setCarregando(true);
    const { error } = await supabaseBrowser.auth.signInWithPassword({ email, password: senha });
    if (error) {
      setErro('Email ou senha incorretos. Tente novamente.');
      setCarregando(false);
    } else {
      router.push('/');
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center" style={{ backgroundColor: '#F5F5F5' }}>
      <div className="bg-white rounded-xl shadow-lg p-8 w-full max-w-sm">
        <div className="flex flex-col items-center mb-6">
          <img src="/logo.png" alt="Deposito Oliveira" className="h-24 w-auto mb-3" />
          <p className="text-sm font-medium" style={{ color: '#666666' }}>Sistema de Orcamentos</p>
        </div>
        <form onSubmit={handleLogin} className="space-y-4">
          <div>
            <label className="block text-sm font-medium mb-1" style={{ color: '#2D2D2D' }}>Email</label>
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required
              className="w-full px-3 py-2 border rounded-lg text-sm"
              style={{ borderColor: '#E5E7EB' }} placeholder="seu@email.com" />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1" style={{ color: '#2D2D2D' }}>Senha</label>
            <input type="password" value={senha} onChange={(e) => setSenha(e.target.value)} required
              className="w-full px-3 py-2 border rounded-lg text-sm"
              style={{ borderColor: '#E5E7EB' }} placeholder="..." />
          </div>
          {erro && <div className="text-sm text-red-600 bg-red-50 rounded-lg p-3">{erro}</div>}
          <button type="submit" disabled={carregando}
            className="w-full py-2.5 rounded-lg text-white font-semibold text-sm"
            style={{ backgroundColor: carregando ? '#ccc' : '#F7941D' }}>
            {carregando ? 'Entrando...' : 'Entrar'}
          </button>
        </form>
        <p className="text-center text-xs mt-6" style={{ color: '#666666' }}>Deposito Oliveira 2026</p>
      </div>
    </div>
  );
}
