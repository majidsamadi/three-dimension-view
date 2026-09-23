<script setup lang="ts">import AppIcon from './AppIcon.vue'; withDefaults(defineProps<{ title: string; message: string; icon?: string }>(), { icon: 'cube' })</script>
<template><div class="empty-state"><div class="empty-icon"><AppIcon :name="icon" :size="36"/></div><h2>{{ title }}</h2><p>{{ message }}</p><div class="d-flex gap-2 justify-content-center flex-wrap"><slot/></div></div></template>
