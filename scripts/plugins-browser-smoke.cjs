const { chromium } = require(process.env.PLAYWRIGHT_MODULE);
const { spawn } = require('node:child_process');
const fs = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');
(async () => {
 const dir = path.resolve('artifacts/plugins-qa'); await fs.mkdir(dir, { recursive:true });
 const server = spawn(process.execPath, ['app/local-server.cjs'], { cwd: process.cwd(), env: { ...process.env, ARNES_DATA_DIR: path.join(dir, 'state-' + Date.now()) }, windowsHide:true, stdio:'pipe' });
 let output=''; server.stdout.on('data',c=>output+=c); server.stderr.on('data',c=>output+=c);
 let browser;
 try {
  browser = await chromium.launch({headless:true, executablePath:process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe'});
  for(let i=0;i<60;i++) {
    if (server.exitCode !== null) throw Error('QA server failed to start. Port 9140 may already be in use.');
    if (output.includes('Harness Hub: http://127.0.0.1:9140/')) break;
    await new Promise(r=>setTimeout(r,200));
  }
  if (!output.includes('Harness Hub: http://127.0.0.1:9140/')) throw Error('QA server did not become ready.');
  const page=await browser.newPage({viewport:{width:1280,height:950}});
  const errors=[]; page.on('pageerror',e=>errors.push(e.message));
  await page.goto('http://127.0.0.1:9140/plugins.html');
  await page.getByRole('button',{name:/Local shell/}).click();
  await page.getByRole('checkbox').check();
  await page.getByRole('button',{name:'Enable plugin',exact:true}).click();
  await page.getByLabel('Working directory').fill(process.cwd());
  await page.getByLabel('Command',{exact:true}).fill("Write-Output 'plugin-browser-smoke'");
  await page.getByRole('button',{name:'Run command',exact:true}).click();
  await page.waitForFunction(()=>document.querySelector('#result')?.textContent.includes('plugin-browser-smoke'),null,{timeout:20000});
  await page.waitForFunction(()=>document.querySelector('#result')?.textContent.includes('completed'),null,{timeout:20000});
  await page.screenshot({path:path.join(dir,'desktop.png'),fullPage:true});
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth > window.innerWidth),false);
  await page.getByRole('button',{name:'Disable plugin',exact:true}).click();
  await page.reload();
  await page.getByRole('button',{name:/Local shell/}).click();
  assert.equal(await page.getByRole('button',{name:'Enable plugin',exact:true}).isDisabled(),true);
  await page.getByRole('button',{name:/Google Workspace/}).click();
  await page.getByRole('button',{name:'Sign in with Google',exact:true}).waitFor();
  assert.equal(await page.locator('input[type=password]').count(),0);
  await page.setViewportSize({width:390,height:844});
  await page.screenshot({path:path.join(dir,'mobile.png'),fullPage:true});
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth > window.innerWidth),false);
  await page.getByRole('button',{name:'Sign in with Google',exact:true}).click();
  await page.waitForFunction(()=>document.getElementById('message').textContent.includes('not configured'));
  await page.getByRole('button',{name:'Disable Google Workspace',exact:true}).click();
  assert.deepEqual(errors,[]);
  await page.goto('http://127.0.0.1:9140/',{waitUntil:'domcontentloaded'});
  await page.getByRole('tab',{name:/^Plugins tab/}).click();
  await page.frameLocator('iframe:not([hidden])').getByRole('heading',{name:'Plugins',exact:true}).waitFor();
  console.log('Browser smoke passed: navigation, grants, shell output, completion polling, disable/reload, Google setup, desktop/mobile overflow, no JS errors.');
 } finally {
  await browser?.close();
  if (server.exitCode === null) {
    server.kill('SIGTERM');
    await new Promise(resolve=>{ const timer=setTimeout(resolve,10000); server.once('exit',()=>{clearTimeout(timer);resolve();}); });
  }
 }
})().catch(e=>{console.error(e);process.exitCode=1;});
