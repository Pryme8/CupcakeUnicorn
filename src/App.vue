<script setup lang="ts">
import { computed, ref } from 'vue'
import GameView from './components/GameView.vue'
import SkyJumpView from './components/SkyJumpView.vue'

type Screen = 'landing' | 'game' | 'skyjump'

// ?game=skyjump drops straight into the endless climber, the same way
// ?level=N jumps into a level of the main game.
const requestedGame = new URLSearchParams(window.location.search).get('game')

const screen = ref<Screen>(requestedGame === 'skyjump' ? 'skyjump' : 'landing')
const playerCount = ref<1 | 2>(1)

const startGame = (count: 1 | 2) => {
  playerCount.value = count
  screen.value = 'game'
}

const startSkyJump = () => {
  screen.value = 'skyjump'
}

const returnToLanding = () => {
  screen.value = 'landing'
}

const heroTagline = computed(() =>
  playerCount.value === 2 ? 'Double the hooves, double the sparkle.' : 'Race for cupcakes and collect the shine.'
)
</script>

<template>
  <main class="app-shell" :class="{ playing: screen !== 'landing' }">
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

        <article class="mode-card">
          <h2>Pegasus Jump</h2>
          <p>Solo high-score climb. Bounce forever, chase butterflies, never touch the bottom.</p>
          <button class="primary" type="button" @click="startSkyJump">Start Climbing</button>
        </article>
      </section>

      <section class="rules">
        <div>
          <h3>How to Play</h3>
          <ul>
            <li>Move, jump, and eat cupcakes to get a speed boost.</li>
            <li>Collect hearts, stars, flowers, grapes, and strawberries for points.</li>
            <li>Items fly to the rainbow cloud once collected.</li>
            <li>Eight levels loop forever: chase cupcakes, fly as a Pegasus, explore a garden maze, catch falling cupcakes, tug a rainbow, copy a dance, pop balloons, and dash past rotten fruit.</li>
            <li>Nobody ever loses. Every level is about collecting as many sparkles as you can.</li>
            <li>No timer, no health bar, just pure sparkle.</li>
          </ul>
        </div>
        <div class="controls">
          <h3>Controls</h3>
          <p>Player 1: WASD (W is the magic key)</p>
          <p>Player 2: Arrow keys (Up is the magic key)</p>
          <p>Tapping your side of the screen works too.</p>
        </div>
        <div class="credits">
          <h3>Credits</h3>
          <p>All assets and coding were AI generated.</p>
          <p>Daisy Butt - Creator</p>
          <p>Dahlia Butt - Co Creator</p>
          <p>Special thanks: Andrew Butt - Dad (Prompt Engineering)</p>
          <p class="credit-note">
            Pegasus Jump is a remake of <em>Kitten Jump</em>, an iPhone game that can no longer be
            found. Its jump arc, hang time and climb rate were measured from
            <a href="https://www.youtube.com/watch?v=mND9LnoQLsI" target="_blank" rel="noopener noreferrer"
              >its trailer</a
            >, the only reference left.
          </p>
        </div>
      </section>
    </section>

    <section v-else-if="screen === 'skyjump'" class="game">
      <div class="game-header">
        <div>
          <h2>Pegasus Jump</h2>
          <p>How high can you get?</p>
        </div>
        <button class="ghost" type="button" @click="returnToLanding">Back to Menu</button>
      </div>
      <SkyJumpView />
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
