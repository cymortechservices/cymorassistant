// Usage: npm run hash -- "your password"   -> prints a bcrypt hash for DASHBOARD_PASSWORD_HASH
import bcrypt from 'bcryptjs';
const pw = process.argv[2];
if (!pw || pw.length < 10) {
  console.error('Provide a password of at least 10 characters: npm run hash -- "your password"');
  process.exit(1);
}
console.log(bcrypt.hashSync(pw, 12));
