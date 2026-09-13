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
      <p>Player 1 uses WASD, Player 2 uses the arrow keys. W or Up is your magic key: jump, flap, drop, tug, or hop!</p>
      <p>Eight levels loop forever: Cupcake Chase, Pegasus Flight, Rainbow Garden Maze, Cupcake Catch, Tug of Rainbow, Mirror Dance, Balloon Pop, and Fruit Dash.</p>
    </div>
  </section>
</template>
