const fs = require('node:fs/promises');
const path = require('node:path');
const { spawn } = require('node:child_process');
// Windows credentials are bound to the signed-in OS user through DPAPI.
async function protect(value, decrypt = false) {
  if (process.platform !== 'win32') return value;
  const expression = decrypt
    ? '[Text.Encoding]::UTF8.GetString([Security.Cryptography.ProtectedData]::Unprotect([Convert]::FromBase64String($s),$null,[Security.Cryptography.DataProtectionScope]::CurrentUser))'
    : '[Convert]::ToBase64String([Security.Cryptography.ProtectedData]::Protect([Text.Encoding]::UTF8.GetBytes($s),$null,[Security.Cryptography.DataProtectionScope]::CurrentUser))';
  return new Promise((resolve, reject) => {
    const child = spawn(path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'),
      ['-NoProfile', '-NonInteractive', '-Command', '$ErrorActionPreference="Stop"; Add-Type -AssemblyName System.Security; $s=[Console]::In.ReadToEnd(); [Console]::Out.Write(' + expression + ')'],
      { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    let output = '';
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', chunk => { output += chunk; });
    child.stderr.resume();
    const timer = setTimeout(() => { child.kill(); reject(Error('Credential protection timed out.')); }, 15000);
    child.once('error', () => { clearTimeout(timer); reject(Error('Credential protection is unavailable.')); });
    child.once('close', code => { clearTimeout(timer); code === 0 ? resolve(output) : reject(Error('Credential protection failed.')); });
    child.stdin.on('error', () => {});
    child.stdin.end(value);
  });
}
function secretStore(directory) {
  let queue = Promise.resolve();
  return {
    async read(name) {
      try { return JSON.parse(await protect(await fs.readFile(path.join(directory, name + '.secret'), 'utf8'), true)); }
      catch (error) { if (error.code === 'ENOENT') return {}; throw error; }
    },
    async write(name, value) {
      const pending = queue.then(async () => {
        await fs.mkdir(directory, { recursive: true, mode: 0o700 });
        const file = path.join(directory, name + '.secret');
        const encrypted = await protect(JSON.stringify(value));
        await fs.writeFile(file + '.tmp', encrypted, { mode: 0o600 });
        await fs.rename(file + '.tmp', file);
      });
      queue = pending.catch(() => {});
      return pending;
    }
  };
}
module.exports = { secretStore };
