// providers/email/sendgrid.js
//
// Real adapter for SendGrid's v3 Mail Send API.
// Activates once SENDGRID_API_KEY and SENDGRID_FROM_EMAIL are both set.
//
// IMPORTANT: written from documented API conventions, not tested against a
// live key in this sandbox (no outbound network access here). Verify
// against https://docs.sendgrid.com/api-reference/mail-send/mail-send
// before relying on it in production.

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
          else reject(new Error(`SendGrid API ${res.statusCode}: ${data.slice(0, 300)}`));
        });
      }
    );
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

module.exports = {
  id: 'sendgrid',
  name: 'SendGrid',
  requiredEnv: ['SENDGRID_API_KEY', 'SENDGRID_FROM_EMAIL'],
  isEnabled(env) {
    return !!(env.SENDGRID_API_KEY && env.SENDGRID_FROM_EMAIL);
  },
  async send(message, env) {
    try {
      const body = JSON.stringify({
        personalizations: [{ to: [{ email: message.to }] }],
        from: { email: env.SENDGRID_FROM_EMAIL, name: 'LiveFair24' },
        subject: message.subject,
        content: [
          { type: 'text/plain', value: message.text || '' },
          { type: 'text/html', value: message.html || `<p>${message.text || ''}</p>` },
        ],
      });
      await post('api.sendgrid.com', '/v3/mail/send', {
        Authorization: `Bearer ${env.SENDGRID_API_KEY}`,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
      }, body);
      return { success: true };
    } catch (err) {
      console.warn('[sendgrid provider]', err.message);
      return { success: false, error: err.message };
    }
  },
};
