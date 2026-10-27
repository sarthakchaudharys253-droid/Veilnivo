import { spawn } from 'node:child_process';

// Environment is inherited directly; secrets are never written to a command or file.
if (!process.env.DATABASE_URL || !process.env.JWT_SECRET) {
  process.stderr.write('Configure DATABASE_URL and JWT_SECRET before starting Veilnivo.\n');
  process.exit(1);
}
let child;
let stopping = false;
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => { stopping = true; child?.kill(signal); });
}
function run(args) {
  return new Promise(resolve => {
    child = spawn(process.execPath, args, { stdio: 'inherit', env: process.env, shell: false });
    child.once('error', () => resolve(1));
    child.once('exit', (code, signal) => resolve(code ?? (signal ? 1 : 0)));
  });
}
// Prisma deploy applies committed migrations only; no development/schema reset commands.
const migrated = await run(['node_modules/prisma/build/index.js', 'migrate', 'deploy']);
if (migrated || stopping) process.exit(migrated || 1);
process.exit(await run(['--import', 'tsx', 'server/index.ts']));
