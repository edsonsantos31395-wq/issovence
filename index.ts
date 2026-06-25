// ══════════════════════════════════════════════════════════
// Edge Function: send-alerts
// Roda diariamente via Supabase Cron
// Envia e-mails para documentos vencendo em 7, 3 e 1 dia(s)
// ══════════════════════════════════════════════════════════

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY')!;
const SUPABASE_URL   = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_KEY   = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const FROM_EMAIL     = 'alertas@venceai.com.br'; // troque pelo seu domínio verificado no Resend

const sb = createClient(SUPABASE_URL, SUPABASE_KEY);

const ALERT_DAYS = [7, 3, 1];

Deno.serve(async () => {
  try {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    let totalSent = 0;

    for (const daysBefore of ALERT_DAYS) {
      const targetDate = new Date(today);
      targetDate.setDate(today.getDate() + daysBefore);
      const dateStr = targetDate.toISOString().split('T')[0];

      // Busca documentos que vencem no dia alvo
      const { data: docs, error } = await sb
        .from('documents')
        .select(`
          id, name, category, due_date, notes,
          user:user_id (
            id,
            email,
            raw_user_meta_data
          )
        `)
        .eq('due_date', dateStr);

      if (error) { console.error('DB error:', error); continue; }
      if (!docs?.length) continue;

      for (const doc of docs) {
        const userId = doc.user?.id;
        if (!userId) continue;

        // Verifica preferências de notificação
        const { data: prefs } = await sb
          .from('notification_prefs')
          .select('email_enabled')
          .eq('user_id', userId)
          .single();

        if (prefs && !prefs.email_enabled) continue;

        // Evita enviar duplicata para o mesmo documento + prazo
        const { data: alreadySent } = await sb
          .from('notification_log')
          .select('id')
          .eq('document_id', doc.id)
          .eq('days_before', daysBefore)
          .single();

        if (alreadySent) continue;

        const userEmail = doc.user?.email;
        const userName  = doc.user?.raw_user_meta_data?.full_name || 'Olá';

        // Envia e-mail via Resend
        const emailBody = buildEmail(userName, doc.name, doc.due_date, daysBefore, doc.category);
        const res = await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${RESEND_API_KEY}`,
            'Content-Type':  'application/json',
          },
          body: JSON.stringify({
            from:    FROM_EMAIL,
            to:      [userEmail],
            subject: `⚠️ ${doc.name} vence em ${daysBefore} dia${daysBefore > 1 ? 's' : ''}!`,
            html:    emailBody,
          }),
        });

        if (res.ok) {
          // Registra no log para não reenviar
          await sb.from('notification_log').insert({
            document_id: doc.id,
            days_before: daysBefore,
          });
          totalSent++;
          console.log(`✅ Email enviado: ${userEmail} → ${doc.name} (${daysBefore}d)`);
        } else {
          const err = await res.text();
          console.error(`❌ Falha ao enviar para ${userEmail}:`, err);
        }
      }
    }

    return new Response(JSON.stringify({ ok: true, sent: totalSent }), {
      headers: { 'Content-Type': 'application/json' },
    });

  } catch (e) {
    console.error('Erro geral:', e);
    return new Response(JSON.stringify({ ok: false, error: e.message }), { status: 500 });
  }
});

// ─── Template de e-mail ───
function buildEmail(name: string, docName: string, dueDate: string, days: number, category: string): string {
  const [y, m, d] = dueDate.split('-');
  const dateFormatted = `${d}/${m}/${y}`;
  const urgencyColor = days === 1 ? '#f87171' : days <= 3 ? '#fbbf24' : '#60a5fa';
  const emoji = days === 1 ? '🚨' : days <= 3 ? '⚠️' : '📅';

  return `
<!DOCTYPE html>
<html lang="pt-BR">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#0f1117;font-family:Inter,Arial,sans-serif">
  <div style="max-width:560px;margin:32px auto;background:#171c27;border-radius:16px;overflow:hidden;border:1px solid #2a3246">
    <div style="background:${urgencyColor};padding:4px 0;text-align:center;font-size:12px;font-weight:700;color:#fff;letter-spacing:.08em">
      ${days === 1 ? 'URGENTE — VENCE AMANHÃ' : `ALERTA — ${days} DIAS PARA VENCER`}
    </div>
    <div style="padding:40px 36px">
      <div style="font-size:40px;margin-bottom:16px">${emoji}</div>
      <h1 style="color:#e8eaf0;font-size:22px;margin:0 0 8px">Olá, ${name}!</h1>
      <p style="color:#7b859e;font-size:15px;margin:0 0 28px">
        Um dos seus documentos está prestes a vencer. Não deixe para depois!
      </p>

      <div style="background:#1e2535;border-radius:12px;padding:20px 24px;border-left:4px solid ${urgencyColor};margin-bottom:28px">
        <div style="font-size:12px;color:#7b859e;text-transform:uppercase;letter-spacing:.06em;margin-bottom:6px">${category || 'Documento'}</div>
        <div style="font-size:20px;font-weight:700;color:#e8eaf0;margin-bottom:4px">${docName}</div>
        <div style="font-size:14px;color:#7b859e">Vence em: <strong style="color:${urgencyColor}">${dateFormatted}</strong></div>
      </div>

      <p style="color:#7b859e;font-size:13px;margin:0">
        Você está recebendo este e-mail porque configurou alertas no <strong style="color:#e8eaf0">VenceAí</strong>.
        Para gerenciar seus documentos, <a href="https://venceai.vercel.app" style="color:#4f8ef7">acesse o painel</a>.
      </p>
    </div>
    <div style="padding:16px 36px;border-top:1px solid #2a3246;text-align:center;font-size:12px;color:#4a5568">
      VenceAí — Controle de Vencimentos · <a href="#" style="color:#4a5568">Cancelar alertas</a>
    </div>
  </div>
</body>
</html>`;
}
