<script setup>
import { t } from '../../../i18n/index.js';
import UiSelect from '../../kit/UiSelect.js';
defineProps({ settings: { type: Object, required: true } });
const emit = defineEmits(['action']);
</script>
<template>
  <fieldset class="gev-chat-account-settings">
    <legend>{{ t('Chat connection') }}</legend>
    <label for="gev-chat-connection">{{ t('Chat connection') }}</label>
    <UiSelect id="gev-chat-connection" class="gev-field" :model-value="settings.provider" @update:model-value="emit('action', 'chat-connection', $event)">
      <option value="">{{ t('Choose a chat connection') }}</option>
      <option value="chatgpt">{{ t('ChatGPT account') }}</option>
      <option value="api">{{ t('Voice provider API key · API charges apply') }}</option>
    </UiSelect>
    <template v-if="settings.provider === 'chatgpt'">
      <label for="gev-chat-account">{{ t('ChatGPT account') }}</label>
      <UiSelect id="gev-chat-account" class="gev-field" :model-value="settings.account" :disabled="settings.updating || settings.pending" @update:model-value="emit('action', 'chat-account', $event)">
        <option value="">{{ t('No signed-in account') }}</option>
        <option v-for="account in settings.accounts" :key="account.id" :value="account.id" :disabled="!account.signedIn">{{ account.label }}</option>
      </UiSelect>
      <p role="status" aria-live="polite">{{ settings.pending ? t('Complete sign-in in your browser.') : settings.connected ? t('ChatGPT account connected') : t('Sign in to use your ChatGPT plan.') }}</p>
      <button id="gev-chat-login" type="button" :disabled="settings.updating || settings.pending" @click="emit('action', 'chat-login')">{{ t('Add a ChatGPT account') }}</button>
      <button id="gev-chat-logout" type="button" :disabled="settings.updating" @click="emit('action', 'chat-logout')">{{ t('Sign out / cancel sign-in') }}</button>
      <a v-if="settings.signInPath" :href="settings.signInPath" target="_blank" rel="noopener noreferrer">{{ t('Continue with ChatGPT') }}</a>
      <label for="gev-chat-model">{{ t('Choose an authorized model') }}</label>
      <UiSelect id="gev-chat-model" class="gev-field" :model-value="settings.model" :disabled="settings.updating || settings.loading || !settings.connected || settings.pending" @update:model-value="emit('action', 'chat-model', $event)">
        <option value="">{{ t('Choose an authorized model') }}</option>
        <option v-for="model in settings.models" :key="model.id" :value="model.id">{{ model.label || model.id }}</option>
      </UiSelect>
    </template>
    <p class="gev-voice-settings-note">{{ settings.note }}</p>
    <p v-if="settings.error" role="alert">{{ settings.error }}</p>
  </fieldset>
</template>
