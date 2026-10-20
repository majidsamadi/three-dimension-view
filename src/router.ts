import { createRouter, createWebHistory } from 'vue-router'
export const router = createRouter({
 history: createWebHistory(import.meta.env.BASE_URL),
 scrollBehavior(to, from, saved) { return saved || (to.path === from.path ? undefined : { top: 0 }) },
 routes: [
 { path:'/', component: () => import('./views/HomeView.vue'), meta: { title:'Home' } },
 { path:'/library', component: () => import('./views/LibraryView.vue'), meta: { title:'Your spaces' } },
 { path:'/new', component: () => import('./views/NewProjectView.vue'), meta: { title:'New space' } },
 { path:'/import', component: () => import('./views/ImportView.vue'), meta: { title:'Restore a project' } },
 { path:'/projects/:id', component: () => import('./views/ProjectView.vue'), meta: { title:'Space overview' } },
 { path:'/projects/:id/preflight', component: () => import('./views/HomePreflightView.vue'), meta: { title:'Home entry preflight' } },
 { path:'/projects/:id/scan', component: () => import('./views/ScanView.vue'), meta: { title:'Capture', immersive:true } },
 { path:'/projects/:id/view', component: () => import('./views/ViewerView.vue'), meta: { title:'3D viewer', immersive:true } },
 { path:'/projects/:id/edit', component: () => import('./views/EditorView.vue'), meta: { title:'Edit space', immersive:true } },
 { path:'/projects/:id/floorplan', component: () => import('./views/FloorplanView.vue'), meta: { title:'Floor plan' } },
 { path:'/projects/:id/import', component: () => import('./views/ImportView.vue'), meta: { title:'Import a model' } },
 { path:'/projects/:id/export', component: () => import('./views/ExportView.vue'), meta: { title:'Export' } },
 { path:'/service/projects/:projectId/upload', component: () => import('./views/ServiceUploadView.vue'), meta: { title:'Service upload' } },
 { path:'/service/scenes/:sceneId/publish', component: () => import('./views/ServicePublishView.vue'), meta: { title:'Publication review' } },
 { path:'/review-fixtures/service-upload', component: () => import('./views/ServiceUploadView.vue'), props: { fixture: () => import('./service/review-fixtures').then(m => m.createFixtureUploadComposition()) }, meta: { title:'Service upload · synthetic review fixture' } },
 { path:'/review-fixtures/service-publish', component: () => import('./views/ServicePublishView.vue'), props: { fixture: () => import('./service/review-fixtures').then(m => m.createFixturePublishComposition()) }, meta: { title:'Publication review · synthetic review fixture' } },
 { path:'/settings', component: () => import('./views/SettingsView.vue'), meta: { title:'Settings' } },
 { path:'/device', component: () => import('./views/DeviceView.vue'), meta: { title:'Device compatibility' } },
 { path:'/guide', component: () => import('./views/GuideView.vue'), meta: { title:'Scanning guide' } },
 { path:'/privacy', component: () => import('./views/PrivacyView.vue'), meta: { title:'Privacy' } },
 { path:'/:pathMatch(.*)*', component: () => import('./views/NotFoundView.vue'), meta: { title:'Page not found' } },
 ],
})
router.afterEach(to => { document.title = `${String(to.meta.title || 'Home')} · Three Dimension View`; requestAnimationFrame(() => { document.getElementById('main-content')?.focus({ preventScroll:true }) }) })
