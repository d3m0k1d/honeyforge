<script setup lang="ts">
import { useAuthStore } from "~/stores/auth";
const auth = useAuthStore();
// auth.initFromStorage(); // delayed to client

const booting = ref(true);

onMounted(() => {
  const minTime = new Promise((resolve) => setTimeout(resolve, 1500));
  const appReady = new Promise((resolve) => onNuxtReady(() => resolve(true)));
  const fallback = new Promise((resolve) => setTimeout(resolve, 5000));

  Promise.race([Promise.all([minTime, appReady]), fallback]).then(() => {
    booting.value = false;
  });
});
</script>

<template>
  <UApp>
    <NuxtRouteAnnouncer />
    <Transition name="boot">
      <AppLoadingScreen v-if="booting" />
    </Transition>
    <NuxtLayout>
      <NuxtPage />
    </NuxtLayout>
  </UApp>
</template>
