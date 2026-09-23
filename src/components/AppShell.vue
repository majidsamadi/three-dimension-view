<script setup lang="ts">
// Adapted from purchased Suha HeaderTwo/HeaderThree, FooterTwo and Sidenav layouts.
import { ref, computed, watch } from 'vue'
import { useRoute } from 'vue-router'
import AppIcon from './AppIcon.vue'
const base = import.meta.env.BASE_URL
const route = useRoute(), menu = ref(false)
const immersive = computed(() => Boolean(route.meta.immersive))
const tabs = [{ to: '/', name: 'Home', icon: 'home' }, { to: '/library', name: 'Spaces', icon: 'library' }, { to: '/new', name: 'New scan', icon: 'scan' }, { to: '/guide', name: 'Guide', icon: 'book' }, { to: '/settings', name: 'Settings', icon: 'settings' }]
watch(() => route.fullPath, () => { menu.value = false })
</script>
<template>
  <div class="app-shell" :class="{ 'immersive-shell': immersive }">
    <a href="#main-content" class="skip-link">Skip to content</a>
    <header v-if="!immersive" class="header-area" id="headerArea"><div class="container h-100 d-flex align-items-center justify-content-between gap-2">
      <RouterLink to="/" class="brand" aria-label="Three Dimension View home"><img :src="`${base}wisestay-mark.webp`" alt="WiseStay" width="42" height="42"><span>Three Dimension<span class="brand-sub">BY WISESTAY</span></span></RouterLink>
      <div class="desktop-nav"><RouterLink v-for="t in tabs" :key="t.to" :to="t.to" :class="{ active: route.path === t.to }">{{ t.name }}</RouterLink></div>
      <button class="icon-button suha-navbar-toggler" aria-label="Open navigation" :aria-expanded="menu" @click="menu = true"><AppIcon name="menu"/></button>
    </div></header>
    <main id="main-content" :class="immersive ? 'immersive-content' : 'page-content-wrapper'" tabindex="-1"><slot/></main>
    <footer v-if="!immersive" class="footer-nav-area" id="footerNav"><nav class="suha-footer-nav container" aria-label="Main navigation"><ul class="h-100 d-flex align-items-center justify-content-between ps-0"><li v-for="t in tabs" :key="t.to" :class="{ active: route.path === t.to, 'scan-tab': t.to === '/new' }"><RouterLink :to="t.to" :aria-current="route.path === t.to ? 'page' : undefined"><AppIcon :name="t.icon"/><span>{{ t.name }}</span></RouterLink></li></ul></nav></footer>
    <div v-if="menu" class="drawer-backdrop" @click.self="menu = false" @keydown.esc="menu = false"><section class="sidenav-wrapper" role="dialog" aria-modal="true" aria-label="Navigation"><div class="d-flex align-items-center justify-content-between"><h2>Your 3D workspace</h2><button class="icon-button" aria-label="Close navigation" autofocus @click="menu = false"><AppIcon name="close"/></button></div><p>Explore spaces. Keep them yours.</p><nav class="sidenav-nav"><RouterLink v-for="t in tabs" :key="t.to" :to="t.to"><AppIcon :name="t.icon"/>{{ t.name }}<AppIcon name="chevron"/></RouterLink><RouterLink to="/device"><AppIcon name="phone"/>Device compatibility<AppIcon name="chevron"/></RouterLink><RouterLink to="/privacy"><AppIcon name="shield"/>Privacy & local storage<AppIcon name="chevron"/></RouterLink></nav><div class="local-note"><AppIcon name="lock"/>No account. No reconstruction server.</div></section></div>
  </div>
</template>
