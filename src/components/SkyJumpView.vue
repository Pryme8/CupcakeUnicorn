<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'
import Phaser from 'phaser'
import { createSkyJumpGame } from '../game/skyjump/createSkyJumpGame'

const containerRef = ref<HTMLDivElement | null>(null)
let game: Phaser.Game | null = null

onMounted(() => {
  if (!containerRef.value) return
  game = createSkyJumpGame(containerRef.value)
})

onBeforeUnmount(() => {
  game?.destroy(true)
  game = null
})
</script>

<template>
  <section class="skyjump-shell">
    <div class="skyjump-frame" ref="containerRef"></div>
    <div class="game-hint">
      <p>Hold Left/Right (or A/D), or drag anywhere, to steer. The Pegasus bounces on its own.</p>
      <p>Catch butterflies for a bigger bounce and a chain bonus. Land on clouds on the way down. Don't fall off the bottom.</p>
    </div>
  </section>
</template>
