import { expect } from '@playwright/test';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { relative, join, matchesGlob } from 'node:path';
import { execFileSync } from 'node:child_process';
import { test, startRestoreTrace, retainRestoreFailure } from '/Users/mxbaylee/projects/spinel-spn-128-production/e2e/supervised-restore-tracing.ts';
import { finishRestoreCrashCleanup } from '/Users/mxbaylee/projects/spinel-spn-128-production/src/server/maintenance/restore-crash-cleanup-fixture.ts';

test('all named failure evidence survives upload selection and capture failure preserves the primary error', async ({ playwright }, info) => {
  const browser = await playwright.chromium.launch();
  const startup = new WeakMap();
  const original = new Error('Synthetic original journey failure');
  try {
    const complete = await browser.newContext();
    startup.set(complete, ['[spinel:startup] synthetic fixture']);
    await startRestoreTrace(complete);
    const page = await complete.newPage();
    await page.setContent('<button onclick="document.body.dataset.clicked=\'yes\'">Record journey</button>');
    await page.getByRole('button').click();
    const broken = await browser.newContext();
    startup.set(broken, []);
    const brokenPage = await broken.newPage();
    await brokenPage.setContent('<p>Unstarted trace negative control</p>');
    const failure = await retainRestoreFailure(browser, info, startup, original);
    expect(failure).toBeInstanceOf(AggregateError);
    expect((failure as AggregateError).cause).toBe(original);
    expect((failure as AggregateError).errors[0]).toBe(original);
    expect((failure as AggregateError).errors).toHaveLength(2);
    expect(String((failure as AggregateError).errors[1])).toMatch(/tracing.*start/i);
    const names = ['restore-startup-0.json','restore-startup-1.json','restore-failure-0-0.png','restore-failure-1-0.png','restore-state-0-0.txt','restore-state-1-0.txt','restore-diagnostic-collection-failures.json','restore-first-failure-0/trace.zip'];
    const workflow = await readFile('/Users/mxbaylee/projects/spinel-spn-128-production/.github/workflows/ci.yml','utf8');
    const globs = workflow.split('\n').map(l => l.trim()).filter(l => l.startsWith('test-results/'));
    for (const name of names) {
      const bytes = await readFile(info.outputPath(name));
      expect(bytes.length).toBeGreaterThan(0);
      expect(globs.some(g => matchesGlob('test-results/case/'+name,g)),name).toBe(true);
      if(name.endsWith('.png')) expect(bytes.subarray(0,8).toString('hex')).toBe('89504e470d0a1a0a');
    }
    expect(JSON.parse(await readFile(info.outputPath('restore-startup-0.json'),'utf8'))).toEqual(['[spinel:startup] synthetic fixture']);
    expect(JSON.parse(await readFile(info.outputPath('restore-diagnostic-collection-failures.json'),'utf8'))).toEqual(['trace-1']);
    expect(await readFile(info.outputPath('restore-state-0-0.txt'),'utf8')).toContain('Record journey');
    const zip = info.outputPath('restore-first-failure-0','trace.zip');
    const members=execFileSync('unzip',['-Z1',zip],{encoding:'utf8'}).trim().split('\n');
    const events=members.filter(x=>x.endsWith('.trace')).map(x=>execFileSync('unzip',['-p',zip,x],{encoding:'utf8'})).join('\n');
    for(const marker of ['context-options','setContent','click','"type":"after"']) expect(events).toContain(marker);
    for(const attachment of info.attachments) {
      expect(attachment.path).toBeTruthy();
      const path=relative(info.outputDir,attachment.path!);
      expect(globs.some(g=>matchesGlob('test-results/case/'+path,g)),path).toBe(true);
    }
    let closed=false;
    const cleanupError=new Error('Synthetic cleanup failure');
    await expect(finishRestoreCrashCleanup([async()=>{throw cleanupError;},async()=>{closed=true;}],{error:failure})).rejects.toMatchObject({cause:failure,errors:[failure,cleanupError]});
    expect(closed).toBe(true);
    await writeFile(info.outputPath('upload-coverage.json'),JSON.stringify({source:'d22baa6997e27c123ef351a8f5321089cc9e345b',names,attachments:info.attachments.map(a=>({name:a.name,path:relative(info.outputDir,a.path!)})),globs,traceMembers:members,primaryPreserved:true,cleanupAttempted:true},null,2));
  } finally { await browser.close(); }
});
