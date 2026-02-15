<script setup lang="ts">
import { computed, ref } from 'vue'
import GameView from './components/GameView.vue'

type Screen = 'landing' | 'game'

const screen = ref<Screen>('landing')
const playerCount = ref<1 | 2>(1)

const startGame = (count: 1 | 2) => {
  playerCount.value = count
  screen.value = 'game'
}

const returnToLanding = () => {
  screen.value = 'landing'
}

const heroTagline = computed(() =>
  playerCount.value === 2 ? 'Double the hooves, double the sparkle.' : 'Race for cupcakes and collect the shine.'
)
</script>

<template>
  <main class="app-shell">
    <section v-if="screen === 'landing'" class="landing">
      <header class="hero">
        <span class="hero-badge">Ages 4-6</span>
        <h1>Cupcake Unicorn</h1>
        <p class="hero-tagline">{{ heroTagline }}</p>
        <img class="hero-image" src="/assets/cupcake_unicorn.png" alt="Cupcake unicorn" />
      </header>

      <section class="mode-grid">
        <article class="mode-card">
          <h2>One Player</h2>
          <p>Dash from a cozy corner. Chase cupcakes and stack your sparkle score.</p>
          <button class="primary" type="button" @click="startGame(1)">Start Solo</button>
        </article>

        <article class="mode-card">
          <h2>Two Players</h2>
          <p>Race a friend from opposite corners. Grab the most hearts and stars.</p>
          <button class="secondary" type="button" @click="startGame(2)">Start Duo</button>
        </article>
      </section>

      <section class="rules">
        <div>
          <h3>How to Play</h3>
          <ul>
            <li>Move, jump, and eat cupcakes to get a speed boost.</li>
            <li>Collect hearts, stars, flowers, grapes, and strawberries for points.</li>
            <li>Items fly to the rainbow cloud once collected.</li>
            <li>No timer, no health bar, just pure sparkle.</li>
          </ul>
        </div>
        <div class="controls">
          <h3>Controls</h3>
          <p>Player 1: WASD (S to eat)</p>
          <p>Player 2: Arrow keys (Down to eat)</p>
        </div>
        <div class="credits">
          <h3>Credits</h3>
          <p>All assets and coding were AI generated.</p>
          <p>Daisy Butt - Creator</p>
          <p>Dahlia Butt - Co Creator</p>
          <p>Special thanks: Andrew Butt - Dad (Prompt Engineering)</p>
        </div>
      </section>
    </section>

    <section v-else class="game">
      <div class="game-header">
        <div>
          <h2>Game On!</h2>
          <p>Player mode: {{ playerCount }}</p>
        </div>
        <button class="ghost" type="button" @click="returnToLanding">Back to Menu</button>
      </div>
      <GameView :player-count="playerCount" />
    </section>
  </main>
</template>
