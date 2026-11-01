# Bazi-Sazi — Step-by-step guide

This guide takes you from zero to a published game. Every step uses things you can click; code is optional.

## 1. Your first game in 5 minutes

1. Open the home page and pick **Empty 3D**. The studio opens (you're signed in as a guest automatically — use *Save account* later to keep your work).
2. **Place a floor.** In the **Place** panel (left) choose *3D Shapes → Plane / Floor*. Click it, or drag it into the scene.
3. **Place a crate.** Choose *3D Shapes → Physics Crate*. It already has a **Rigid Body** and a **Collider**, so it will fall.
4. **Move it up.** With the crate selected press **W** and drag the green (Y) arrow up. Or type a Position in **Details** (right).
5. **Press ▶ Play** (or **Ctrl+P**). The game runs in the *Game* tab. Press **Stop** to go back — nothing you did while playing changes your project.
6. **Add a player.** *Characters → Top-Down Player*. Play again and move with **WASD** / arrow keys (or the on-screen joystick on phones).
7. **Make the camera follow.** Select *Main Camera* in the **Outliner** → *Add component* → **Follow Target** → Target: `Player`.

> Tip: every setting shows a hint when you hover its name. **Ctrl+K** opens the command palette — type what you want to do.

## 2. Build a Clash-style card battler (sample project)

Goal: two teams, towers on each side, cards that cost elixir, troops that walk over bridges and fight. The finished version is the **Royale Arena** template — build it yourself to learn how it works, or open the template and read along.

### 2.1 The arena
1. New project → **Empty 3D**.
2. *Place → 3D Shapes → Plane / Floor*. In Details set Scale to `15, 1, 26` and the Mesh color to green.
3. Make a river: *3D Shapes → Cube*, Scale `16, 0.3, 1.8`, color blue. It has a **Collider**, so the **pathfinding** treats it as a wall.
4. Make two bridges: Cubes at X = `-3.5` and `3.5`, Scale `1.6, 0.2, 2.4`, color brown. Add the tag `walkable` and **remove their Collider** — troops can now cross only here. Split the river into three pieces so the bridges are gaps.

### 2.2 Towers
1. *Place → Strategy → Defense Tower*. It uses the *Crown Tower* model from Starter Content and has:
   - **Unit AI** with *Move speed 0* — speed 0 means it's a building that shoots anything in range.
   - **Health** with *Health bar* on.
2. Put it at `-3.5, 0, 7.5`, duplicate it (**Ctrl+D**) to `3.5, 0, 7.5`.
3. For the enemy, duplicate again, move to the other side (Z = `-7.5`), set Unit AI **Team: red**, and swap the model in the **3D Model** component for *tower_red* (Content Browser → Starter Content → 3D Models, or the Model dropdown).
4. Add a **King Tower** for each team in the middle. On the red king's **Health** choose *On death: win*; on the blue king choose *On death: game over*.

### 2.3 Troops as prefabs
1. *Place → Strategy → Soldier (blue)*. It has a Knight model with *Idle / Walk / Attack* animations, **Unit AI** (team blue) and **Health**.
2. Right-click it in the Outliner → **Save as prefab**, name it `Knight`. Delete the one in the scene.
3. Do the same with *Enemy (red)* → prefab `Knight Red`, and *Archer (blue)* → prefab `Archer`.

Unit AI does the thinking for you: it finds the nearest enemy, walks there with pathfinding (over the bridges), plays *Walk*, then *Attack* when in range. Archers shoot arrows from a distance.

### 2.4 Cards and elixir
1. *Place → Strategy → Card Deck (deploy)*. In Details set:
   - **Cards**: one per line as `Prefab:cost:icon`, e.g.
     ```
     Knight:3:⚔️
     Archer:3:🏹
     ```
   - **Resource label** `Elixir`, **Max** `10`, **Regen / second** `0.4`.
   - **Allowed area min / max**: `-6.5, 0, 1.5` → `6.5, 0, 12` (your half).
2. Add a second **Card Deck** for the enemy: cards `Knight Red:3`, **Team red**, **AI controlled** on, **Resource variable** `enemyElixir`, area on the enemy half.
3. Press **Play**: tap a card, then tap your half of the arena. Watch the battle!

### 2.5 Juice
- Health already shows **floating damage numbers** and death **particle bursts**; buildings **shake the camera** when they fall.
- Add music: Content Browser → *Music & Sounds* → drag *Adventure music* into the scene, tick **Loop**.
- World Settings (right) → **Graphics** → *Quality*, *Ambient occlusion*, *Glow (bloom)*, *Vignette*.

### 2.6 Publish
Press **Publish**, choose an address and you get a link anyone can play — phones included.

## 3. Base builder (Clash of Clans-style)
Open the **Village Builder** template. Key pieces:
- **Strategy Camera** on the camera: drag / WASD to pan, wheel or pinch to zoom.
- **Card Deck** with *Mode: build* and *Grid snap 2* becomes a build menu; buildings cost **gold**.
- **Resource Generator** on the Gold Mine adds gold every few seconds (with a “+8” popup).
- **Spawner**s at the map edge send **Goblins** (*Unit AI, Targets: buildings*) that raid your village; **Cannons** (*Unit AI* speed 0 + cannonball) defend it. Goblins drop gold (*Health → Reward variable*).

## 4. Tower defense
Open **Tower Defense**:
- The road is an entity named **Road** whose children are waypoints. Enemies use **Path Follower** (*Path: Road*, *Damage at end: Castle*).
- The **Waves** script makes the spawner faster every 20 seconds — open it from the Content Browser → *Scripts* to see 15 lines of beginner-friendly JavaScript.

## 5. Mini Metro-style puzzle
Open **Metro Lines**:
- Stations are sprites tagged `station`. The **Route Builder** component lets players drag from station to station to draw lines; a train shuttles along each line and sends a `vehicleArrived` message to stations.
- The **Station** script handles passengers: open it to see how messages, `game.vars` and `game.fx.popText` create the whole game.

## 6. Logic: visual scripts and code
**Visual script** (no code): *Add → Visual script*. It opens as a tab. Drag nodes from the left, connect the ▶ pins to chain actions. Example: *On Collision (tag coin)* → *Add To Variable (score)* → *Destroy (Other)* → *Play Sound*.

**Script** (JavaScript or TypeScript) with autocomplete:
```js
function update(dt) {
  if (input.pressed('jump') && self.isGrounded()) self.setVelocity(self.velocity.x, 12);
}

function onCollision(other) {
  if (other.hasTag('coin')) {
    game.vars.score = (game.vars.score || 0) + 1;
    game.fx.popText(other.position, '+1', '#ffd166');
    audio.sfx('coin');
    other.destroy();
  }
}
```
Useful APIs: `game.spawn('Knight', { position: [0, 0, 5], team: 'blue' })`, `self.moveTo(x, y, z)` (pathfinding), `game.findNearest('enemy', self.position)`, `game.tween(self.scale, { x: 2, y: 2, z: 2 }, 0.3, { ease: 'outBack', yoyo: true })`, `game.fx.shake()`.

**AI assistant**: the ✨ AI button. Describe what you want (“add an archer tower that shoots goblins”). Every change it makes is undoable with **Ctrl+Z**.

## 7. Debugging & performance
- **Output Log** shows `log()` messages and script errors (click the source to jump to the script).
- **Message Log** audits the project: missing prefabs, broken references, script syntax errors. Errors block publishing.
- **Profiler**: FPS, frame/logic/physics/render time, draw calls, triangles. Toggle *Show colliders*, change game speed.
- While playing, select an entity to see its **live** position, velocity and variables in Details.
- Pause and **step one frame** from the toolbar.
- Viewport: **Show → Stats**, *Lit / Clay / Wireframe* shading, *Top / Front / Right* views.
- Games lower their resolution automatically on slow devices (*Auto resolution*) and use *Quality: auto* (high on desktop, low on phones).

## 8. Keyboard cheat sheet
| Action | Keys |
|---|---|
| Command palette | Ctrl/⌘ + K |
| Play / Stop | Ctrl/⌘ + P |
| Save | Ctrl/⌘ + S |
| Undo / Redo | Ctrl/⌘ + Z / Ctrl/⌘ + Shift + Z |
| Move / Rotate / Scale | W / E / R |
| Snap | G |
| Focus selection | F |
| Duplicate / Delete | Ctrl/⌘ + D / Delete |
| Fly the camera | hold right mouse + WASD / Q E |
| Toggle content drawer | Ctrl/⌘ + B |
| All shortcuts | Shift + ? |
