/**
 * Interactive Gmail SMTP setup — writes credentials to .env
 *
 * Usage: node scripts/setup-gmail.js
 *
 * Gmail App Password: Google Account → Security → 2-Step Verification → App passwords
 */

const fs = require('fs');
const path = require('path');
const readline = require('readline');

const envPath = path.resolve(__dirname, '..', '.env');

function updateEnv(key, value) {
  let content = fs.existsSync(envPath) ? fs.readFileSync(envPath, 'utf8') : '';
  const line = `${key}=${value}`;
  const regex = new RegExp(`^${key}=.*$`, 'm');

  if (regex.test(content)) {
    content = content.replace(regex, line);
  } else {
    content += `\n${line}`;
  }

  fs.writeFileSync(envPath, content.trim() + '\n');
}

async function main() {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const ask = (q) => new Promise((resolve) => rl.question(q, resolve));

  console.log('\n=== Gmail SMTP Setup (real emails to mobile) ===\n');
  console.log('1. Enable 2-Step Verification on your Google account');
  console.log('2. Create App Password: Google Account → Security → App passwords → Mail\n');

  const email = await ask('Gmail address: ');
  const appPassword = await ask('Gmail App Password (16 chars, no spaces): ');

  rl.close();

  if (!email || !appPassword) {
    console.error('Email and app password are required.');
    process.exit(1);
  }

  updateEnv('SMTP_HOST', 'smtp.gmail.com');
  updateEnv('SMTP_PORT', '587');
  updateEnv('SMTP_SECURE', 'false');
  updateEnv('SMTP_USER', email.trim());
  updateEnv('SMTP_PASS', appPassword.replace(/\s/g, ''));
  updateEnv('EMAIL_FROM', `Internship Portal <${email.trim()}>`);

  console.log('\n.env updated. Restart the server: npm run dev:all');
  console.log('Register with your real email — verification mail will arrive in inbox.\n');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
