import { createApp } from 'vue'
import { createPinia } from 'pinia'
import ElementPlus from 'element-plus'
import 'element-plus/dist/index.css'
import App from './App.vue'
import router from './router'
import { permission } from './directives/permission'
import './style.css'

createApp(App)
  .use(createPinia())
  .use(router)
  .use(ElementPlus)
  .directive('permission', permission)
  .mount('#app')
