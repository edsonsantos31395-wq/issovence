-- ══════════════════════════════════════════════
-- VENCEAÍ — Setup completo do banco de dados
-- Cole no SQL Editor do Supabase e execute
-- ══════════════════════════════════════════════

-- 1. TABELA DE DOCUMENTOS
CREATE TABLE IF NOT EXISTS public.documents (
  id          UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id     UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  name        TEXT NOT NULL,
  category    TEXT DEFAULT 'outros',
  due_date    DATE NOT NULL,
  notes       TEXT,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- 2. TABELA DE PREFERÊNCIAS DE NOTIFICAÇÃO
CREATE TABLE IF NOT EXISTS public.notification_prefs (
  id                UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id           UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL UNIQUE,
  email_enabled     BOOLEAN DEFAULT TRUE,
  whatsapp_enabled  BOOLEAN DEFAULT FALSE,
  whatsapp_number   TEXT,
  updated_at        TIMESTAMPTZ DEFAULT NOW()
);

-- 3. TABELA DE LOG DE NOTIFICAÇÕES ENVIADAS (evita duplicatas)
CREATE TABLE IF NOT EXISTS public.notification_log (
  id           UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  document_id  UUID REFERENCES public.documents(id) ON DELETE CASCADE,
  days_before  INTEGER NOT NULL,  -- 7, 3 ou 1
  sent_at      TIMESTAMPTZ DEFAULT NOW()
);

-- 4. ROW LEVEL SECURITY — cada usuário vê apenas os seus dados
ALTER TABLE public.documents          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notification_prefs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notification_log   ENABLE ROW LEVEL SECURITY;

CREATE POLICY "users_own_documents" ON public.documents
  FOR ALL USING (auth.uid() = user_id);

CREATE POLICY "users_own_prefs" ON public.notification_prefs
  FOR ALL USING (auth.uid() = user_id);

CREATE POLICY "users_own_log" ON public.notification_log
  FOR SELECT USING (
    document_id IN (
      SELECT id FROM public.documents WHERE user_id = auth.uid()
    )
  );

-- 5. ÍNDICES para performance
CREATE INDEX IF NOT EXISTS idx_documents_user     ON public.documents(user_id);
CREATE INDEX IF NOT EXISTS idx_documents_due_date ON public.documents(due_date);
CREATE INDEX IF NOT EXISTS idx_notif_log_doc      ON public.notification_log(document_id, days_before);
