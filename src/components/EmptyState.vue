<script setup lang="ts">
import AppIcon from './AppIcon.vue'
withDefaults(defineProps<{ title: string; message: string; icon?: string; headingTag?: 'h1' | 'h2' }>(), { icon: 'cube', headingTag: 'h2' })
</script>
<template><div class="empty-state"><div class="empty-icon"><AppIcon :name="icon" :size="36"/></div><component :is="headingTag">{{ title }}</component><p>{{ message }}</p><div class="d-flex gap-2 justify-content-center flex-wrap"><slot/></div></div></template>
