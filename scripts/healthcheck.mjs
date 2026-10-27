const port = process.env.PORT || '3001';
try {
  const response = await fetch(`http://127.0.0.1:${port}/api/ready`, {signal: AbortSignal.timeout(4000)});
  const result = await response.json();
  process.exit(response.ok && result.ok === true ? 0 : 1);
} catch { process.exit(1); }
