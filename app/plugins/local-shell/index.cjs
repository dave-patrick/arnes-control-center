const { spawn } = require('node:child_process');
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');

module.exports = ({ PluginError }) => {
  const jobs = new Map();
  let disposed = false;
  const windows = process.platform === 'win32';
  function stop(job, reason) {
    if (job.state !== 'running') return;
    job.reason = reason;
    job.state = 'stopping';
    if (windows) {
      const killer = spawn(path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'taskkill.exe'), ['/PID', String(job.child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
      killer.on('error', () => job.child.kill());
    } else { try { process.kill(-job.child.pid, 'SIGKILL'); } catch { job.child.kill('SIGKILL'); } }
  }
  function view(job) {
    const { child, timer, bytes, ...result } = job;
    return result;
  }
  return {
    status: async () => ({ state: 'ready', detail: windows ? 'PowerShell · commands run as your local user' : 'System shell · commands run as your local user' }),
    actions: {
      run: async ({ command, cwd, timeout = 30 }) => {
        if (typeof command !== 'string' || !command.trim() || command.length > 20000) throw new PluginError('Enter a command under 20,000 characters.');
        if (typeof cwd !== 'string' || !path.isAbsolute(cwd)) throw new PluginError('Choose an absolute working directory.');
        let directory;
        try { directory = await fs.realpath(cwd); if (!(await fs.stat(directory)).isDirectory()) throw Error(); }
        catch { throw new PluginError('Working directory does not exist or is inaccessible.'); }
        if (disposed) throw new PluginError('Shell plugin was disabled. Enable it and retry.', 403);
        timeout = Number(timeout);
        if (!Number.isFinite(timeout) || timeout < 1 || timeout > 120) throw new PluginError('Time limit must be 1–120 seconds.');
        if ([...jobs.values()].filter(j => ['running', 'stopping'].includes(j.state)).length >= 3) throw new PluginError('Three jobs are active. Cancel one or wait.', 409);
        for (const [id, job] of jobs) if (!['running', 'stopping'].includes(job.state) && (jobs.size >= 50 || Date.now() - Date.parse(job.startedAt) > 600000)) jobs.delete(id);
        const executable = windows ? path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe') : '/bin/sh';
        const args = windows ? ['-NoLogo', '-NoProfile', '-NonInteractive', '-OutputFormat', 'Text', '-EncodedCommand', Buffer.from("$ProgressPreference = 'SilentlyContinue'; [Console]::OutputEncoding = [Text.UTF8Encoding]::new($false); & {\n" + command + "\n}", 'utf16le').toString('base64')] : ['-c', command];
        const child = spawn(executable, args, { cwd: directory, windowsHide: true, detached: !windows, stdio: ['ignore', 'pipe', 'pipe'] });
        const job = { id: crypto.randomUUID(), cwd: directory, startedAt: new Date().toISOString(), state: 'running', stdout: '', stderr: '', exitCode: null, truncated: false, child, bytes: 0 };
        jobs.set(job.id, job);
        for (const key of ['stdout', 'stderr']) {
          child[key].setEncoding('utf8');
          child[key].on('data', chunk => {
            const remaining = Math.max(0, 1024 * 1024 - job.bytes);
            const buffer = Buffer.from(chunk);
            job[key] += buffer.subarray(0, remaining).toString('utf8');
            job.bytes += Math.min(buffer.length, remaining);
            if (buffer.length > remaining) { job.truncated = true; stop(job, 'output-limit'); }
          });
        }
        child.on('error', () => { clearTimeout(job.timer); job.state = 'failed'; job.stderr += 'Could not start the local shell.'; });
        child.on('close', code => {
          clearTimeout(job.timer);
          job.exitCode = code;
          job.state = job.reason || (code === 0 ? 'completed' : 'failed');
          job.finishedAt = new Date().toISOString();
        });
        job.timer = setTimeout(() => stop(job, 'timed-out'), timeout * 1000);
        job.timer.unref();
        return view(job);
      },
      jobs: async () => ({ jobs: [...jobs.values()].reverse().map(view) }),
      cancel: async ({ id }) => {
        const job = jobs.get(id);
        if (!job) throw new PluginError('Job not found. Jobs are kept in memory for this server session.', 404);
        stop(job, 'cancelled');
        return view(job);
      }
    },
    dispose: async () => {
      disposed = true;
      const active = [...jobs.values()].filter(job => ['running', 'stopping'].includes(job.state));
      for (const job of active) stop(job, 'cancelled');
      await Promise.all(active.map(job => new Promise(resolve => { if (job.child.exitCode !== null) resolve(); else job.child.once('close', resolve); })));
    }
  };
};
