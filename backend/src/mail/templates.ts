import type { MailMessage } from './mail.service.js';

const escapeHtml = (s: string) =>
  s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

/** Простое письмо с одной кнопкой-ссылкой: текстовая версия дублирует HTML. */
function layout(opts: {
  heading: string;
  paragraphs: string[];
  action?: { label: string; url: string };
  footer: string;
}): Pick<MailMessage, 'text' | 'html'> {
  const text = [
    opts.heading,
    '',
    ...opts.paragraphs,
    ...(opts.action ? ['', `${opts.action.label}: ${opts.action.url}`] : []),
    '',
    opts.footer,
  ].join('\n');

  const html = `<!doctype html><html lang="ru"><body style="margin:0;background:#f4f5f7;font-family:Arial,Helvetica,sans-serif;color:#14181f">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:24px 12px">
<table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border:1px solid #d9dde3;border-radius:6px">
<tr><td style="padding:28px 28px 8px;font-size:20px;font-weight:600">${escapeHtml(opts.heading)}</td></tr>
<tr><td style="padding:8px 28px;font-size:15px;line-height:22px">${opts.paragraphs
    .map((p) => `<p style="margin:0 0 12px">${escapeHtml(p)}</p>`)
    .join('')}</td></tr>${
    opts.action
      ? `<tr><td style="padding:8px 28px 20px"><a href="${escapeHtml(opts.action.url)}" style="display:inline-block;background:#c8102e;color:#ffffff;text-decoration:none;padding:11px 20px;border-radius:4px;font-size:14px;font-weight:600">${escapeHtml(opts.action.label)}</a></td></tr>`
      : ''
  }
<tr><td style="padding:12px 28px 24px;font-size:12px;line-height:18px;color:#5b6472;border-top:1px solid #d9dde3">${escapeHtml(opts.footer)}</td></tr>
</table></td></tr></table></body></html>`;
  return { text, html };
}

export function verificationEmail(
  to: string,
  name: string,
  url: string,
  ttlHours: number,
): MailMessage {
  return {
    to,
    subject: 'Подтвердите email — HUATECH',
    ...layout({
      heading: 'Подтвердите email',
      paragraphs: [
        `Здравствуйте, ${name}!`,
        'Вы зарегистрировались в личном кабинете HUATECH. Чтобы войти, подтвердите адрес почты.',
        `Ссылка действует ${ttlHours} ч.`,
      ],
      action: { label: 'Подтвердить email', url },
      footer:
        'Если вы не регистрировались, просто проигнорируйте это письмо — без подтверждения вход невозможен.',
    }),
  };
}

export function statusChangedEmail(
  to: string,
  vehicle: { title: string; vin: string | null },
  stepTitle: string,
  step: number,
  url: string | null,
): MailMessage {
  return {
    to,
    subject: `${vehicle.title}: ${stepTitle}`,
    ...layout({
      heading: 'Статус машины изменился',
      paragraphs: [
        vehicle.vin ? `${vehicle.title} · VIN ${vehicle.vin}` : vehicle.title,
        `Новый этап (${step} из 13): «${stepTitle}».`,
      ],
      action: url ? { label: 'Открыть в кабинете', url } : undefined,
      footer:
        'Вы получили это письмо, потому что включены уведомления о статусе машины. Их можно отключить в личном кабинете.',
    }),
  };
}
