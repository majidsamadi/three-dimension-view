<script setup lang="ts">
import type { AccountState } from '@/composables/useServiceAccount'
// Live-mode WiseStay sign-in (central user.wizestay.com through the same-origin session route).
// Deliberately not a live region: each service view keeps a single role="status" headline.
defineProps<{ state: AccountState; busy: boolean }>()
defineEmits<{ signIn: []; signOut: [] }>()
</script>
<template>
  <section v-if="state !== 'none'" class="card detail-card service-account" :data-account="state" aria-labelledby="service-account-heading">
    <h2 id="service-account-heading">WiseStay account</h2>
    <p v-if="state === 'checking'">Checking your WiseStay session.</p>
    <template v-else-if="state === 'signed-in'">
      <p>Signed in with WiseStay. Requests use your central WiseStay session.</p>
      <button class="btn btn-outline-secondary" type="button" :disabled="busy" @click="$emit('signOut')">Sign out</button>
    </template>
    <template v-else>
      <p>You are signed out. Sign in with WiseStay to use the Home Scanner service.</p>
      <button class="btn btn-primary" type="button" :disabled="busy" @click="$emit('signIn')">Sign in with WiseStay</button>
    </template>
  </section>
</template>
