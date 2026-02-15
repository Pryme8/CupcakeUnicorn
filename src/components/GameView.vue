<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import Phaser from 'phaser'
import { createGame } from '../game/createGame'

type Props = {
  playerCount: 1 | 2
}

const props = defineProps<Props>()
const containerRef = ref<HTMLDivElement | null>(null)
let game: Phaser.Game | null = null

const mountGame = () => {
  if (!containerRef.value) return
  game = createGame(containerRef.value, { playerCount: props.playerCount })
}

const destroyGame = () => {
  if (!game) return
  game.destroy(true)
  game = null
}

onMounted(mountGame)
onBeforeUnmount(destroyGame)

watch(
  () => props.playerCount,
  () => {
    destroyGame()
    mountGame()
  }
)
</script>

<template>
  <section class="game-shell">
    <div class="game-frame" ref="containerRef"></div>
    <div class="game-hint">
      <p>Move with WASD (Player 1) or arrows (Player 2). Jump with W or up.</p>
      <p>Eat with S (Player 1) or down (Player 2).</p>
    </div>
  </section>
</template>
