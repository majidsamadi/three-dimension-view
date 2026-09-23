import { test, expect, type Page } from '@playwright/test'
async function organize(page: Page, name='My test apartment') {
 await page.goto('/new'); await page.getByLabel('Space name', {exact:false}).fill(name)
 await page.getByRole('radio', {name:/Set up the space first/}).check()
 await page.getByRole('button', {name:'Create space & continue'}).click()
 await expect(page).toHaveURL(/\/projects\/[a-f0-9-]+$/)
 return new URL(page.url()).pathname
}
async function sample(page: Page) {
 await page.goto('/');await page.getByRole('button',{name:'Explore the sample'}).click()
 await expect(page).toHaveURL(/\/projects\/[a-f0-9-]+\/view$/)
 return new URL(page.url()).pathname.replace(/\/view$/,'')
}
test('empty workspace is honest, responsive and keyboard navigable',async({page},info)=>{
 const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));await page.goto('/')
 await expect(page.getByRole('heading',{name:'Your first space starts here.'})).toBeVisible()
 await expect(page.getByText('Interactive illustrative apartment')).toBeVisible()
 await expect(page.locator('.hero-model canvas')).toBeVisible()
 await expect.poll(()=>page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth+1)).toBe(true)
 await page.screenshot({path:info.outputPath('home.png'),fullPage:true});expect(errors).toEqual([])
})
test('create, edit, reload and safely delete a real local project',async({page})=>{
 const url=await organize(page);await expect(page.getByRole('heading',{name:'My test apartment',exact:true})).toBeVisible()
 await page.getByRole('link',{name:'Edit space',exact:true}).click()
 await page.getByLabel('Space name',{exact:true}).fill('Updated apartment')
 await page.getByLabel('Notes',{exact:true}).fill('Saved locally, not submitted to a server.')
 await page.getByRole('button',{name:'Save changes',exact:true}).click();await expect(page.getByText('All changes saved locally')).toBeVisible()
 await page.goto(url);await page.reload();await expect(page.getByRole('heading',{name:'Updated apartment',exact:true})).toBeVisible()
 await expect(page.getByText('Saved locally, not submitted to a server.')).toBeVisible()
 await page.getByRole('button',{name:'Delete this space',exact:true}).click();await expect(page.getByRole('dialog')).toBeVisible()
 await page.getByRole('dialog').getByRole('button',{name:'Cancel',exact:true}).click();await expect(page.getByRole('heading',{name:'Updated apartment',exact:true})).toBeVisible()
 await page.getByRole('button',{name:'Delete this space',exact:true}).click();await page.getByRole('dialog').getByRole('button',{name:'Delete space',exact:true}).click()
 await expect(page).toHaveURL('/library');await expect(page.getByRole('link',{name:/Updated apartment/})).toHaveCount(0)
})
test('sample viewer, section edits and floor-plan export are functional',async({page},info)=>{
 const url=await sample(page);await expect(page.locator('.scene-viewer canvas').first()).toBeVisible();await page.screenshot({path:info.outputPath('viewer.png')})
 await page.goto(`${url}/edit`);await page.getByRole('tab',{name:'Sections',exact:true}).click();await page.getByLabel('Section name',{exact:true}).fill('Edited sample section')
 await page.getByRole('button',{name:'Save changes',exact:true}).click();await expect(page.getByText('All changes saved locally')).toBeVisible()
 await page.screenshot({path:info.outputPath('editor.png'),fullPage:true});await page.goto(`${url}/floorplan`)
 await expect(page.getByText('Bedroom',{exact:true}).first()).toBeVisible()
 const download=page.waitForEvent('download');await page.getByRole('button',{name:/Export SVG/}).click();expect((await download).suggestedFilename()).toMatch(/\.svg$/)
})
test('exports and restores a complete W3D backup without overwriting the source',async({page})=>{
 const url=await sample(page);await page.goto(`${url}/export`)
 await page.locator('.consent-check input').check()
 const pending=page.waitForEvent('download');await page.getByRole('button',{name:'Export file',exact:true}).click();const download=await pending,path=await download.path();expect(path).not.toBeNull()
 await page.goto('/import');// Supply a named buffer because Playwright's temporary download path has no W3D extension.
 const fs=await import('node:fs/promises');await page.locator('input[type=file]').setInputFiles({name:'restored.w3d',mimeType:'application/vnd.wisestay.project',buffer:await fs.readFile(path!)})
 await page.getByRole('button',{name:'Import to this device'}).click();await expect(page).toHaveURL(/\/projects\/[a-f0-9-]+$/);expect(new URL(page.url()).pathname).not.toBe(url)
 await page.goto(url);await expect(page.getByRole('heading',{name:'Sample apartment',exact:true})).toBeVisible()
})
test('rejects bad backups visibly without importing fake geometry',async({page})=>{
 await page.goto('/import');await page.locator('input[type=file]').setInputFiles({name:'bad.w3d',mimeType:'application/octet-stream',buffer:Buffer.from('not-a-project-file')});await page.getByRole('button',{name:'Import to this device'}).click();await expect(page.getByRole('alert')).toContainText(/not a supported|invalid/i);await expect(page).toHaveURL('/import')
})
test('unsupported desktop capture does not fabricate a scan',async({page})=>{
 const url=await organize(page,'Compatibility check');await page.goto(`${url}/scan`)
 await expect(page.getByText(/does not.*support|not available|not supported|not expose|unavailable/i).first()).toBeVisible()
 await expect(page.locator('.capture-review')).toHaveCount(0)
 await page.goto(url);await expect(page.getByText('No scan sections yet.',{exact:false})).toBeVisible()
})
test('settings, help, privacy, device and missing routes remain usable',async({page})=>{
 const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message))
 for(const route of ['/settings','/guide','/privacy','/device','/not-a-page']) {await page.goto(route);await expect(page.locator('h1').first()).toBeVisible();await expect.poll(()=>page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth+1)).toBe(true)}
 expect(errors).toEqual([])
})
test('previously loaded SPA and saved records open offline',async({page,context})=>{
 const url=await organize(page,'Offline apartment');await page.goto('/library');await page.evaluate(async()=>{await navigator.serviceWorker.ready})
 await page.reload();await expect.poll(()=>page.evaluate(()=>!!navigator.serviceWorker.controller)).toBe(true)
 await context.setOffline(true);await page.goto(url);await expect(page.getByRole('heading',{name:'Offline apartment',exact:true})).toBeVisible();await context.setOffline(false)
})

for (const format of ['ply', 'glb', 'obj'] as const) {
 test(`exports and reimports ${format.toUpperCase()} geometry in a real browser`, async ({page}) => {
  const source = await sample(page)
  await page.goto(`${source}/export`)
  await page.locator(`input[name="export-format"][value="${format}"]`).check()
  await page.locator('.consent-check input').check()
  const pending = page.waitForEvent('download')
  await page.getByRole('button', {name:'Export file', exact:true}).click()
  const download = await pending
  const path = await download.path()
  expect(path).not.toBeNull()
  const fs = await import('node:fs/promises')
  const bytes = await fs.readFile(path!)
  expect(bytes.byteLength).toBeGreaterThan(100)
  const destination = await organize(page, `${format.toUpperCase()} round trip`)
  await page.goto(`${destination}/import`)
  await page.locator('input[type=file]').setInputFiles({name:`round-trip.${format}`,mimeType:'application/octet-stream',buffer:bytes})
  await page.getByRole('button', {name:'Import to this device'}).click()
  await expect(page).toHaveURL(destination)
  await expect(page.locator('.scene-row')).toHaveCount(1)
  await expect(page.locator('.scene-row')).toContainText('Imported model')
  await expect(page.locator('.scene-viewer canvas').first()).toBeVisible()
  await page.reload()
  await expect(page.locator('.scene-row')).toContainText('round-trip')
 })
}
test('imports an ASCII PLY point cloud without inventing triangles', async ({page}) => {
 const destination = await organize(page, 'Point-cloud import')
 await page.goto(`${destination}/import`)
 const ply = 'ply\nformat ascii 1.0\nelement vertex 3\nproperty float x\nproperty float y\nproperty float z\nend_header\n0 0 0\n1 0 0\n0 1 0\n'
 await page.locator('input[type=file]').setInputFiles({name:'points.ply',mimeType:'application/octet-stream',buffer:Buffer.from(ply)})
 await page.getByRole('button', {name:'Import to this device'}).click()
 await expect(page).toHaveURL(destination)
 await expect(page.locator('.scene-row')).toContainText('3 vertices · 0 triangles')
 await expect(page.locator('.scene-viewer canvas').first()).toBeVisible()
})
