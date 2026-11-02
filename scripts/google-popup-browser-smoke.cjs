const { chromium } = require(process.env.PLAYWRIGHT_MODULE);
const fs = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');
(async () => {
 const dir=path.resolve('artifacts/google-popup-qa'); await fs.mkdir(dir,{recursive:true});
 const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe'});
 try {
  const context=await browser.newContext({viewport:{width:1280,height:900}});
  const manifest=JSON.parse(await fs.readFile('app/plugins/google-workspace/manifest.json','utf8'));
  let enabled=false, connected=false, auth='idle', connections=0;
  await context.route('**/hub/plugins**',async route=>{
   const request=route.request(); const url=new URL(request.url()); let data;
   if(request.method()==='GET') data={plugins:[{...manifest,enabled,status:{state:connected?'connected':'needs-connection',detail:connected?'Account authorized · read-only access':'Choose an account.',authorization:auth}}],activity:[],token:'browser-test-token'};
   else if(url.pathname.endsWith('/enable')) {enabled=request.postDataJSON().enabled; data={enabled};}
   else if(url.pathname.endsWith('/connect')) {assert.equal(request.postDataJSON().popup,true); connections++; auth='pending'; data={authorizationUrl:'https://accounts.google.com/o/oauth2/v2/auth?client_id=fixture.apps.googleusercontent.com&prompt=select_account%20consent&response_type=code'};}
   else if(url.pathname.endsWith('/disconnect')) {connected=false;auth='idle';data={message:'Google disconnected.'};}
   else throw Error('Unexpected UI request: '+url.pathname);
   await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(data)});
  });
  await context.route('https://accounts.google.com/**',route=>route.fulfill({status:200,contentType:'text/html',body:'<!doctype html><title>Mock Google account chooser</title><h1>Account chooser test fixture</h1>'}));
  const page=await context.newPage(); const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto('http://127.0.0.1:9140/plugins.html');
  await page.getByRole('button',{name:'Sign in with Google',exact:true}).waitFor();
  assert.equal(await page.locator('input[type=password]').count(),0);
  assert.equal(await page.getByRole('checkbox').count(),0);
  await page.screenshot({path:path.join(dir,'desktop.png'),fullPage:true});
  await page.setViewportSize({width:390,height:844});
  await page.screenshot({path:path.join(dir,'mobile.png'),fullPage:true});
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  const popupEvent=page.waitForEvent('popup');
  await page.getByRole('button',{name:'Sign in with Google',exact:true}).click();
  const popup=await popupEvent; await popup.waitForURL('https://accounts.google.com/**');
  assert.equal(new URL(popup.url()).searchParams.get('prompt'),'select_account consent');
  assert.equal(connections,1);
  assert.equal(await popup.evaluate(()=>window.opener===null),true);
  const closed=popup.waitForEvent('close');
  await popup.goto('http://127.0.0.1:9140/google-connected.html').catch(error=>{if(!/closed|aborted|ERR_ABORTED/i.test(error.message))throw error;});
  await closed;
  connected=true;auth='completed';
  await page.getByRole('button',{name:'Switch Google account',exact:true}).waitFor({timeout:15000});
  await page.getByRole('button',{name:'Disconnect Google account',exact:true}).click();
  await page.getByRole('button',{name:'Sign in with Google',exact:true}).waitFor();
  await page.evaluate(()=>{window.open=()=>null;});
  await page.getByRole('button',{name:'Sign in with Google',exact:true}).click();
  await page.waitForFunction(()=>document.getElementById('message').textContent.includes('Allow popups'));
  assert.equal(connections,1);
  assert.deepEqual(errors,[]);
  console.log('Popup browser smoke passed: one click opens account chooser, no setup fields, popup closes on completion, parent refreshes, disconnect and blocked-popup recovery, desktop/mobile layout. Google responses were mocked.');
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
