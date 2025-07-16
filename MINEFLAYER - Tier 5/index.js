const mineflayer = require('mineflayer')
const { pathfinder, Movements, goals } = require('mineflayer-pathfinder')
const armorManager = require('mineflayer-armor-manager')
const { Vec3 } = require('vec3')
const { exec } = require('child_process')

// Immediately activate item looking straight down
async function activateDown(bot) {
  await bot.activateItem(false, new Vec3(0, -1, 0))
}

// Bot configuration array
const botConfigs = [
  {
    username: 'pvt.asdeoyt@gmail.com',
    host: '107.138.47.146',
    port: 25565,
    version: '1.21.4',
    auth: 'microsoft'
  }
]

// Store bot instances
const bots = []

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

async function startBots() {
  for (const config of botConfigs) {
    const bot = mineflayer.createBot(config)
    bot.loadPlugin(pathfinder)
    bot.loadPlugin(armorManager)
    bots.push(bot)

    // --- Error debugging handlers ---
    bot.on('error', err => {
      const name = bot.username || bot._client?.username || config.username || 'unknown'
      console.log(`[${name}] Error:`, err)
    })
    bot.on('end', () => {
      const name = bot.username || bot._client?.username || config.username || 'unknown'
      console.log(`[${name}] Disconnected`)
    })
    bot.on('kicked', (reason, loggedIn) => {
      const name = bot.username || bot._client?.username || config.username || 'unknown'
      console.log(`[${name}] Kicked:`, reason)
    })

    bot.on('chat', (username, message) => {
      if (message === 'buff') {
        const items = bot.inventory.items();
        console.log('=== INVENTORY DEBUG ===');
        console.log(`Total items: ${items.length}`);

        items.forEach((item, idx) => {
          const id = getPotionId(item);
          console.log(`#${idx + 1} – ${item.name}  potionId:${id}`);
        });

        console.log('=== END INVENTORY DEBUG ===');
        throwInstantHealth(bot);
      }

      if (message === 'tier 4') {
        exec('code "c:\\Users\\pvtas\\OneDrive\\Desktop\\MINEFLAYER - Tier 4"', (error, stdout, stderr) => {
          if (error) {
            console.log(`Error opening Tier 4 script: ${error.message}`)
            return
          }
          if (stderr) {
            console.log(`stderr: ${stderr}`)
          }
          console.log(`stdout: ${stdout}`)
        })
        exec('start cmd /K "cd /d c:\\Users\\pvtas\\OneDrive\\Desktop\\MINEFLAYER - Tier 4 && node index.js"', (error, stdout, stderr) => {
          if (error) {
            console.log(`Error running Tier 4 index.js: ${error.message}`)
            return
          }
          if (stderr) {
            console.log(`stderr: ${stderr}`)
          }
          console.log(`stdout: ${stdout}`)
        })
      }
    });

    function getPotionId(item) {
      const comp = item.components?.find(c => c.type === 'potion_contents')
      return comp?.data?.potionId
    }

    // Buff logic: checks for any splash instant health potion (strong or regular)
    function canBuffSelf() {
      return bot.inventory.items().some(item =>
        item.name === 'splash_potion'
      )
    }

    async function throwInstantHealth(bot) {
      // 1. Find a splash instant health potion in inventory
      const potion = bot.inventory.items().find(
        item => item.name === 'splash_potion'
      )

      if (!potion) {
        bot.chat('No healing splash potion found')
        return
      }
      // 2. Equip it in hand
      await bot.equip(potion, 'hand')

      // Add a short random delay before buffing (between 0.05 and 0.5 seconds)
      const delayMs = 20 + Math.random() * 250
      await new Promise(resolve => setTimeout(resolve, delayMs))

      // 3. Look at the block at your feet
      const feetBlock = bot.blockAt(bot.entity.position.offset(0, -1, 0))
      if (feetBlock) {
        await bot.lookAt(feetBlock.position, true)
        await bot.waitForTicks(5)
      }
      await bot.activateItem(false, new Vec3(0, -1, 0))
      bot.chat('Threw a splash instant health potion at my feet!')

      // 5. Stop moving forward after throwing
      bot.setControlState('forward', false)

      // 6. Immediately resume attacking after healing
      healing = false
    }

    let attackInterval = null
    let currentTarget = null
    let strafeDirection = null
    let strafeChangeTimer = 0
    let strafeDurationTimer = 0
    let healing = false

    bot.on('playerCollect', (collector, itemDrop) => {
      if (collector !== bot.entity) return
      setTimeout(() => {
        bot.armorManager.equipAll().catch(() => {})
      }, 250)
    })

    function getStrongestSword() {
      const swords = bot.inventory.items().filter(item => item.name.endsWith('_sword'))
      if (swords.length === 0) return null
      const swordOrder = [
        'netherite_sword',
        'diamond_sword',
        'iron_sword',
        'stone_sword',
        'golden_sword',
        'wooden_sword'
      ]
      swords.sort((a, b) => swordOrder.indexOf(a.name) - swordOrder.indexOf(b.name))
      return swords[0]
    }

    function stopAttack() {
      if (attackInterval) clearInterval(attackInterval)
      attackInterval = null
    }

    function startAttack(target) {
      if (attackInterval) clearInterval(attackInterval)
      attackInterval = setInterval(() => {
        if (
          target &&
          target.isValid &&
          bot.entity.position.distanceTo(target.position) < 3.5
        ) {
          const sword = getStrongestSword()
          if (sword) {
            bot.equip(sword, 'hand').then(() => {
              bot.attack(target)
            }).catch(() => {
              bot.attack(target)
            })
          } else {
            bot.attack(target)
          }
        }
      }, 1000 / 23)
    }

    bot.on('physicsTick', async () => {
      const nearest = bot.nearestEntity(entity =>
        entity.type === 'player' &&
        entity.username !== bot.username
      )

      // Buff (heal) self if health < 5 hearts (10 health)
      if (bot.health < 10 && canBuffSelf()) {
        if (!healing) {
          healing = true
        }
        stopAttack()
        bot.setControlState('forward', false)
        bot.setControlState('left', false)
        bot.setControlState('right', false)
        bot.setControlState('sprint', false)
        bot.pathfinder.setGoal(null)
        await throwInstantHealth(bot)
        // Do not return here, so it keeps trying every tick until health >= 10
      } else {
        healing = false
      }

      if (
        nearest &&
        nearest.isValid &&
        bot.entity.position.distanceTo(nearest.position) < 10 &&
        !healing
      ) {
        // Start sprinting
        bot.setControlState('sprint', true)

        // Randomly choose a new direction every 0.3-1.2 seconds
        if (strafeChangeTimer <= 0) {
          const rand = Math.random()
          if (rand < 0.33) {
            strafeDirection = 'left'
          } else if (rand < 0.66) {
            strafeDirection = 'right'
          } else {
            strafeDirection = 'back'
          }
          // Next direction change in 0.3-1.2 seconds (in ticks)
          strafeChangeTimer = Math.floor((Math.random() * 0.9 + 0.3) * 20)
          // Stay strafing in this direction for 0.5-2.5 seconds (in ticks)
          strafeDurationTimer = Math.floor((Math.random() * 2 + 0.5) * 20)
        } else {
          strafeChangeTimer--
        }

        // Only strafe if duration timer is active
        if (strafeDurationTimer > 0) {
          bot.setControlState('left', strafeDirection === 'left')
          bot.setControlState('right', strafeDirection === 'right')
          bot.setControlState('back', strafeDirection === 'back')
          // Strafing overrides forward movement
          bot.setControlState('forward', false)
          strafeDurationTimer--
        } else {
          // Stop strafing if duration is over
          bot.setControlState('left', false)
          bot.setControlState('right', false)
          bot.setControlState('back', false)
          // Resume moving toward the player if not strafing
          bot.setControlState('forward', true)
        }

        // Pathfind toward the player (optional, for smarter navigation)
        const mcData = require('minecraft-data')(bot.version)
        const movements = new Movements(bot, mcData)
        bot.pathfinder.setMovements(movements)
        bot.pathfinder.setGoal(new goals.GoalFollow(nearest, 1))

        // Start attacking at 16 CPS
        if (currentTarget !== nearest) {
          stopAttack()
          currentTarget = nearest
          startAttack(currentTarget)
        }
      } else if (!healing) {
        // Stop all movement and attacking if no valid target
        bot.setControlState('forward', false)
        bot.setControlState('left', false)
        bot.setControlState('right', false)
        bot.setControlState('back', false)
        bot.setControlState('sprint', false)
        bot.pathfinder.setGoal(null)
        currentTarget = null
        strafeChangeTimer = 0
        strafeDurationTimer = 0
      }
    })

    // Wait 5 seconds before logging in the next bot
    await delay(5000)
  }
}

startBots()