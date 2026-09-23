import { createApp } from 'vue'
import 'bootstrap/dist/css/bootstrap.min.css'
import './assets/suha.css'
import './assets/app.css'
import App from './App.vue'
import { router } from './router'
import { loadSettings } from './composables/useSettings'
void loadSettings().finally(() => { createApp(App).use(router).mount('#app') })
