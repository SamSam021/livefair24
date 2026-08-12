// providers/email/resend.js
//
// Real adapter for Resend's Send Email API — a simpler alternative to
// SendGrid if you're starting fresh.
// Activates once RESEND_API_KEY and RESEND_FROM_EMAIL are both set.
//
// IMPORTANT: written from documented API conventions, not tested against a
// live key in this sandbox (no outbound network access here). Verify
// against https://resend.com/docs/api-reference/emails/send-email before
// relying on it in production.

const https = require('https');

function post(hostname, pathName, headers, body) {
  return new Promise((resolve, reject) => {
    const req = https.request(
      { hostname, path: pathName, method: 'POST', headers },
      (res) => {
        let data = '';
        res.on('data', (c) => (data += c));
        res.on('end', () => {
          if (res.statusCode >= 200 && res.statusCode < 300) resolve({ statusCode: res.statusCode, data });
          else reject(new Error(`Resend API ${res.statusCode}: ${data.slice(0, 300)}`));
        });
      }
    );
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

module.exports = {
  id: 'resend',
  name: 'Resend',
  requiredEnv: ['RESEND_API_KEY', 'RESEND_FROM_EMAIL'],
  isEnabled(env) {
    return !!(env.RESEND_API_KEY && env.RESEND_FROM_EMAIL);
  },
  async send(message, env) {
    try {
      const body = JSON.stringify({
        from: env.RESEND_FROM_EMAIL,
        to: [message.to],
        subject: message.subject,
        html: message.html || `<p>${message.text || ''}</p>`,
        text: message.text || '',
      });
      await post('api.resend.com', '/emails', {
        Authorization: `Bearer ${env.RESEND_API_KEY}`,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
      }, body);
      return { success: true };
    } catch (err) {
      console.warn('[resend provider]', err.message);
      return { success: false, error: err.message };
    }
  },
};
