const mineflayer      = require('mineflayer');
const mcData     = require('minecraft-data')('1.21.4')  // adjust to match your server version
const { pathfinder, Movements, goals } = require('mineflayer-pathfinder')
const armorManager = require('mineflayer-armor-manager')
const Vec3 = require('vec3')

//BOT INSTANCE
const bot = mineflayer.createBot({
  host:'107.138.47.146',//host: '173.73.200.194',
  port: 25565,
  username: 'saiermcasdeo@gmail.com',
  version: '1.21.4',
  auth: 'microsoft', // or 'mojang' for older versions
});

//PLUGINS
bot.loadPlugin(pathfinder)
bot.loadPlugin(armorManager)

// Initial gearing on spawn
bot.once('spawn', () => {
    console.log('Bot spawned and starting initial gearing.')
    state = "gearing"
})

//VARIABLES & CONSTANTS
var state ="IDLE"
var target = null
var consecutiveMisses = 0 // Track consecutive misses for progressive miss chance
var strafeDirection = null // Current strafe direction (null, 'left', 'right', 'back')
var strafeEndTime = 0 // When current strafe should end
var lastStrafeDecision = 0 // When last strafe decision was made
const TARGETING_RANGE = 25 // Close range targeting
const KITE_RANGE = 50
const REACH_MIN = 2.85 // Minimum attack reach
const REACH_MAX = 3.68 // Maximum attack reach
const MISS_CHANCE_BASE = 0.04 // 18% base miss chance
const MISS_CHANCE_MAX_BASE = 0.14 // 20% maximum base miss chance
const MISS_STREAK_INCREASE_MIN = 0.05 // 5% minimum increase per consecutive miss
const MISS_STREAK_INCREASE_MAX = 0.12 // 12% maximum increase per consecutive miss
const MISS_STREAK_RESET = 5 // Reset miss streak after 5 attempts
const CPS = 16 //sheepy cps
const HEALTH_THRESHOLD = 10
const HUNGER_THRESHOLD = 18
const COOLDOWN = new Map()
const LASTACTION = new Map()

// Ally system constants
const ALLY_LIST = [''] // Players the bot will not attack
const ALLY_MAX_DISTANCE = 7.5 // Maximum distance from allied players

// Valid food items the bot can eat
const VALID_FOODS = [
    'enchanted_golden_apple',
    'golden_apple',
    'golden_carrot',
    'cooked_beef', // steak
    'cooked_porkchop',
    'cooked_rabbit',
    'cooked_mutton',
    'bread',
    'cooked_cod',
    'baked_potato',
    'cooked_chicken',
]

// COOLDOWNS, time in miliseconds 
COOLDOWN.set('attack',800/CPS) //time between attacks, modify via CPS const
COOLDOWN.set('stateprint',500) // time between console output of state
COOLDOWN.set('gearing',500) // time for gearing process
COOLDOWN.set('healing',1000) // time between healing attempts
COOLDOWN.set('eating',500) // time between eating attempts
COOLDOWN.set('playerCollect',250) // time for player collect gearing
COOLDOWN.set('movementSwing',75) // ~13 CPS for movement swinging
COOLDOWN.set('lookAround',2000) // 2 seconds between look around actions
COOLDOWN.set('targetCheck',2000) // 2 seconds between target checks
COOLDOWN.set('strafeDecision',4000) // 4 seconds between strafe decisions

/*bot state priority
1. equip armor [implemented] -> gearing system with cooldown
2. heal [implemented] -> check if health below 10, throw splash potions away from target with cooldown. if below 7, double pots
3. eat food [implemented] -> hunger ≤18 interrupts all functions except gearing and healing
4. return to ally [implemented] -> if too far from ally, return to them
5. attack target [implemented] -> basic combat with CPS limiting with progressive miss chance
6. move to target [implemented] -> pathfinding with sprint and kiting
7. get new target [implemented] -> nearest player within targeting range (excluding allies)
*/

//INTERRUPT TRIGGERS
bot.on("death", () => {
    bot_reset()
});

bot.on('entityGone', (entity) => {
    if (target && entity.id === target.id) {
        console.log("Target entity is gone (died or left)");
        bot_reset();
    }
});

bot.on('playerCollect', (collector, itemDrop) => {
    if (collector !== bot.entity) return
    state = "gearing"
    if (canDoAction("playerCollect")) {
        bot.armorManager.equipAll().catch(() => {})
    }
});

bot.on('whisper', (from, msg) => {
    bot.chat('recieved: ' + msg)
});

bot.on('physicsTick', async () => {
    // Constantly activate item when in eating state
    if (state === "EATING") {
        bot.activateItem();
        
        // Jump and face away from target while eating
        jumpAndFaceAwayWhileEating();
    } else {
        // Stop jumping when not eating
        bot.setControlState('jump', false);
    }
})

bot.on('physicsTick', async () => {
    try {
        // Continuous target checking every 2 seconds (except when eating or gearing)
        if (state !== "EATING" && state !== "gearing" && canDoAction("targetCheck")) {
            checkForClosestTarget()
        }

        // Bot state priority: 1. gear -> 2. heal -> 3. eat -> 4. ally -> 5. attack -> 6. move -> 7. target
        
        // 1. Equip armor - highest priority
        if(state === "gearing"){
            gear()
        }
        // 2. Heal - second priority
        else if(bot.health < HEALTH_THRESHOLD && canHealSelf()){
            heal()
        }
        // 3. Eat food - third priority, interrupts combat but not gearing/healing
        else if(bot.food <= HUNGER_THRESHOLD && canEatFood()){
            eat()
        }
        // Special handling for eating state - check if still hungry
        else if(state == "EATING"){
            if (bot.food > HUNGER_THRESHOLD) {
                console.log('No longer hungry, stopping eating')
                state = "IDLE"
                equipStrongestSword()
            }
            return
        }
        // 4. Return to ally - fourth priority
        else if(isTooFarFromAlly()){
            return_to_ally()
        }
        // 5. Attack target - fifth priority (not while eating)
        else if(target && target.position && bot.entity.position.distanceTo(target.position) <= REACH_MAX && state !== "EATING"){
            attack_target()
        }
        // 6. Move to target - sixth priority (not while eating)
        else if(target && target.position && bot.entity.position.distanceTo(target.position) <= KITE_RANGE && state !== "EATING"){
            move_to_target()
        }
        // Target too far or lost
        else if(target && target.position && bot.entity.position.distanceTo(target.position) > KITE_RANGE){
            console.log("Target too far, resetting")
            bot_reset()
        }
        // 7. Get new target - lowest priority
        else{
            get_new_target()
        }

        //logging
        if (canDoAction("stateprint")){
            console.log(state)
        }
    } catch (error) {
        console.log('Physics tick error:', error.message)
        // Reset bot state on error to prevent getting stuck
        if (error.message.includes('PartialReadError') || error.message.includes('Read error')) {
            bot_reset()
        }
    }
});

//STATE FUNCTIONS

// 1. EQUIP ARMOR
function gear(){
    state = "GEARING UP"
    
    // Equip armor
    bot.armorManager.equipAll().catch(() => {})
    
    // Equip strongest sword
    equipStrongestSword()
    
    // Reset state after gearing cooldown and ensure sword is equipped
    if (canDoAction("gearing")) {
        state = "IDLE"
        equipStrongestSword()
    }
}

// 2. HEAL
async function heal() {
    if (state !="HEALING" && canDoAction("healing")){
        state = "HEALING"

        // Find a splash instant health potion in inventory
        const potion = await GetItemInInventory('splash_potion')

        if (!potion) {
            console.log('No healing splash potion found')
            state = "IDLE"
            return
        }
        
        try {
            // Add a short random delay before healing (between 0.05 and 0.5 seconds)
            const ticks = Math.floor(Math.random() * 10) + 1;
            await bot.waitForTicks(ticks);
          
            // Turn away from target if there is one and run away while healing
            if (target) {
                // Calculate direction away from target
                const awayFromTarget = bot.entity.position.minus(target.position).normalize()
                const lookPosition = bot.entity.position.plus(awayFromTarget.scaled(2))
                await bot.lookAt(lookPosition, true)
                
                // Start sprinting away from target
                bot.setControlState('sprint', true)
                bot.setControlState('forward', true)
                console.log('Running away from target while healing')
            } 
            
            if(bot.health < 7){
                await bot.activateItem(false, new Vec3(0, -1, 0))
                COOLDOWN.set('healing',500) //double pot
            }else{
                await bot.activateItem(false, new Vec3(0, -1, 0))
                COOLDOWN.set('healing',1000)
            }

            // Stop moving after healing
            bot.setControlState('sprint', false)
            bot.setControlState('forward', false)

            // Immediately resume normal state after healing and re-equip sword
            state = "IDLE"
            equipStrongestSword()
            console.log('Healing complete, resuming combat')
        } catch (error) {
            console.log('Error during healing:', error.message)
            // Stop movement on error
            bot.setControlState('sprint', false)
            bot.setControlState('forward', false)
            state = "IDLE"
            equipStrongestSword()
        }
    }
}

// 3. EAT FOOD
async function eat() {
    // Start eating if not already eating and cooldown allows
    if (state !== "EATING" && canDoAction("eating")) {
        state = "EATING"
        const food = await getBestFood()
        
        if (!food) {
            console.log('No valid food found in inventory')
            state = "IDLE"
            return
        }
        
        console.log('Started eating food - will jump and face away from target')
        // Don't reset state here - let it continue until hunger is satisfied
    }
}

// 4. RETURN TO ALLY
function return_to_ally(){
    state = "RETURNING TO ALLY"
    
    const nearestAlly = getNearestAlly()
    if (!nearestAlly) {
        console.log("No ally found to return to")
        state = "IDLE"
        return
    }
    
    const distance = bot.entity.position.distanceTo(nearestAlly.position)
    console.log(`Returning to ally ${nearestAlly.username} (${Math.floor(distance)} blocks away)`)
    
    // Reset current target since we're prioritizing ally proximity
    target = null
    
    // Sprint to ally
    bot.setControlState('sprint', true)
    bot.pathfinder.setGoal(new goals.GoalFollow(nearestAlly, 3)) // Follow within 3 blocks
}

// 5. ATTACK TARGET
function attack_target(){
    // Check if target still exists
    if (!target || !target.position) {
        console.log("Target lost during attack")
        bot_reset()
        return
    }
    
    state = "ATTACKING TARGET"
    // Look at the target's eye level (1.62 above position.y for players)
    const eyePos = target.position.offset(0, 1.62, 0);
    bot.lookAt(eyePos);
    
    const distance = bot.entity.position.distanceTo(target.position)
    
    // Handle strafing substate
    handleStrafing()
    
    // Calculate progressive miss chance based on consecutive misses
    const baseMissChance = MISS_CHANCE_BASE + Math.random() * (MISS_CHANCE_MAX_BASE - MISS_CHANCE_BASE)
    const streakIncrease = consecutiveMisses * (MISS_STREAK_INCREASE_MIN + Math.random() * (MISS_STREAK_INCREASE_MAX - MISS_STREAK_INCREASE_MIN))
    const currentMissChance = Math.min(baseMissChance + streakIncrease, 0.85) // Cap at 85% miss chance
    
    // Generate random reach for this attack (between 2.85 - 3.90)
    const currentReach = REACH_MIN + Math.random() * (REACH_MAX - REACH_MIN)
    
    if(canDoAction("attack")){
        if (distance <= currentReach) {
            // Within attack range - check for miss
            const missRoll = Math.random()
            if (missRoll < currentMissChance) {
                // Miss - swing but don't attack
                bot.swingArm()
                consecutiveMisses++
                console.log(`Attack missed! (${(missRoll * 100).toFixed(1)}% roll, ${(currentMissChance * 100).toFixed(1)}% threshold) - Miss streak: ${consecutiveMisses}`)
                
                // Reset miss streak after 5 consecutive attempts
                if (consecutiveMisses >= MISS_STREAK_RESET) {
                    console.log(`Miss streak reset after ${MISS_STREAK_RESET} consecutive attempts`)
                    consecutiveMisses = 0
                }
            } else {
                // Hit - do real damage and reset miss streak
                bot.attack(target)
                console.log(`Attack hit! Reach: ${currentReach.toFixed(2)}, Miss chance was: ${(currentMissChance * 100).toFixed(1)}% - Miss streak reset`)
                consecutiveMisses = 0 // Reset miss streak on successful hit
            }
        } else if (distance <= 8) {
            // Within 8 blocks but outside attack range - fake swing
            fakeSwingAtTarget()
        }
    }
}

// Handle strafing substate during combat
function handleStrafing() {
    const now = Date.now()
    
    // Check if current strafe movement should end
    if (strafeDirection && now >= strafeEndTime) {
        // Stop current strafe movement
        bot.setControlState('left', false)
        bot.setControlState('right', false)
        bot.setControlState('back', false)
        strafeDirection = null
        console.log("Strafe movement ended")
    }
    
    // Make new strafe decision every 4 seconds
    if (canDoAction("strafeDecision")) {
        // Completely random movement selection
        const movementOptions = ['left', 'right', 'back', 'none']
        const randomMovement = movementOptions[Math.floor(Math.random() * movementOptions.length)]
        
        // Stop any current movement first
        bot.setControlState('left', false)
        bot.setControlState('right', false)
        bot.setControlState('back', false)
        
        if (randomMovement === 'left' || randomMovement === 'right') {
            const strafeDuration = 1000 + Math.random() * 2000 // Random 1-3 seconds
            
            bot.setControlState(randomMovement, true)
            strafeDirection = randomMovement
            strafeEndTime = now + strafeDuration
            
            console.log(`Started strafing ${randomMovement} for ${(strafeDuration/1000).toFixed(1)}s`)
            
        } else if (randomMovement === 'back') {
            const backDuration = 500 // 0.5 seconds
            
            bot.setControlState('back', true)
            strafeDirection = 'back'
            strafeEndTime = now + backDuration
            
            console.log(`Started backing up for 0.5s`)
            
        } else {
            // 'none' - stay still or continue current movement
            strafeDirection = null
            console.log("No strafe movement this cycle")
        }
    }
    
    // 2% chance to jump during strafing
    if (strafeDirection && Math.random() < 0.02) {
        bot.setControlState('jump', true)
        console.log("Strafing jump!")
        // Jump will automatically stop after a tick
        setTimeout(() => {
            bot.setControlState('jump', false)
        }, 50)
    }
}

// 6. MOVE TO TARGET
async function move_to_target(){
    // Check if target still exists and has position
    if (!target || !target.position) {
        console.log("Target lost during movement")
        bot_reset()
        return
    }
    
    state = "MOVING TO TARGET"
    
    // Calculate the minimum attack range (just outside of REACH_MIN)
    const minAttackRange = REACH_MIN + 0.1 // Small buffer to avoid getting inside the target
    
    // Start moving to target, but stop at min attack range
    bot.setControlState('sprint', true)
    bot.pathfinder.setGoal(new goals.GoalFollow(target, minAttackRange))
    
    // Constantly swing sword if target is within 10 blocks
    if (target && target.position) {
        const distance = bot.entity.position.distanceTo(target.position)
        if (distance <= 10 && canDoAction("movementSwing")) {
            // Look at target and swing (no damage)
            const eyePos = target.position.offset(0, 1.62, 0);
            bot.lookAt(eyePos);
            bot.swingArm()
            console.log("Movement swinging - target within 10 blocks")
        }
    }
}

// 7. GET NEW TARGET
function get_new_target(){
    state = "LOOKING FOR TARGET"
    
    // Look around for targets
    if (canDoAction("lookAround")) {
        lookAround()
    }
    
    // Just sit idle if no target found
    if (!target) {
        state = "IDLE"
    }
}

//COSMETIC FUNCTIONS

function fakeSwingAtTarget() {
    if (!target || !target.position || !canDoAction("attack")) return
    
    // Look at the target's eye level for visual effect
    const eyePos = target.position.offset(0, 1.62, 0);
    bot.lookAt(eyePos);
    
    // Swing arm without attacking (visual only)
    bot.swingArm();
    console.log("Fake swinging at target (visual intimidation)")
}

function lookAround() {
    // Look in a random direction
    const yaw = Math.random() * Math.PI * 2 // Random horizontal rotation
    const pitch = (Math.random() - 0.5) * 0.5 // Slight up/down look
    
    bot.look(yaw, pitch)
    console.log("Looking around for targets...")
}

function jumpAndFaceAwayWhileEating() {
    // Jump while eating
    bot.setControlState('jump', true);
    
    // Face away from target and move forward if there is one
    if (target && target.position) {
        try {
            // Calculate direction away from target
            const awayFromTarget = bot.entity.position.minus(target.position).normalize();
            const lookPosition = bot.entity.position.plus(awayFromTarget.scaled(5));
            bot.lookAt(lookPosition, true).catch(() => {}); // Catch any look errors
            
            // Move forward away from target while eating
            bot.setControlState('forward', true);
        } catch (error) {
            // Silently handle any direction calculation errors
        }
    } else {
        // No target, just jump in place
        bot.setControlState('forward', false);
    }
}

//HELPER FUNCTIONS

// Check if bot has a specific effect
function hasEffect(effectName) {
    const effect = mcData.effectsByName[effectName]
    if (!effect) return false
    
    return bot.entity.effects && bot.entity.effects[effect.id] !== undefined
}

function checkForClosestTarget() {
    const closestEnemy = get_nearest_enemy_player()
    
    if (!closestEnemy) {
        // No enemies found
        if (target) {
            console.log("No enemies detected - clearing current target")
            target = null
        }
        return
    }
    
    const distance = bot.entity.position.distanceTo(closestEnemy.position)
    
    // Only engage targets within range
    if (distance > TARGETING_RANGE) {
        if (target) {
            console.log(`Closest enemy ${closestEnemy.username} too far (${Math.floor(distance)} blocks) - clearing target`)
            target = null
        }
        return
    }
    
    // Check if we need to switch targets
    if (!target || target.id !== closestEnemy.id) {
        const previousTarget = target ? target.username : "none"
        target = closestEnemy
        console.log(`Target switch: ${previousTarget} → ${target.username} at ${Math.floor(distance)} blocks (closest enemy)`)
    }
}

function isAlly(playerName) {
    return ALLY_LIST.includes(playerName)
}

function getNearestAlly() {
    const allies = bot.players
    let nearestAlly = null
    let nearestDistance = Infinity
    
    for (const playerName in allies) {
        const player = allies[playerName]
        if (isAlly(playerName) && player.entity && player.entity.position) {
            const distance = bot.entity.position.distanceTo(player.entity.position)
            if (distance < nearestDistance) {
                nearestDistance = distance
                nearestAlly = player.entity
            }
        }
    }
    
    return nearestAlly
}

function isTooFarFromAlly() {
    const nearestAlly = getNearestAlly()
    if (!nearestAlly) {
        return false // No ally online, don't worry about distance
    }
    
    const distance = bot.entity.position.distanceTo(nearestAlly.position)
    return distance > ALLY_MAX_DISTANCE
}

function get_nearest_enemy_player(){
    const players = Object.values(bot.players)
        .map(player => player.entity)
        .filter(entity => 
            entity && 
            entity.type === 'player' &&
            entity.username !== bot.username &&
            !isAlly(entity.username) &&
            entity.position
        )
    
    if (players.length === 0) return null
    
    // Find the closest enemy player
    let closest = null
    let closestDistance = Infinity
    
    for (const player of players) {
        const distance = bot.entity.position.distanceTo(player.position)
        if (distance < closestDistance) {
            closestDistance = distance
            closest = player
        }
    }
    
    return closest
}

// Shared helper function for getting items in inventory
async function GetItemInInventory(itemName) {
    let found_item = bot.inventory.items().find(item => item.name === itemName)
    if (found_item){
        await bot.equip(found_item, 'hand')
        return true
    }else{
        return false
    }
}

// Shared helper function for checking if item exists in inventory
function hasItemInInventory(itemName) {
    return bot.inventory.items().some(item => item.name === itemName)
}

function getPotionId(item) {
    const comp = item.components?.find(c => c.type === 'potion_contents')
    return comp?.data?.potionId
}

// Buff logic: checks for any splash instant health potion (strong or regular)
function canHealSelf() {
    return hasItemInInventory('splash_potion')
}

// Check if bot has any valid food
function canEatFood() {
    return VALID_FOODS.some(food => hasItemInInventory(food))
}

// Find the best food item to eat (prioritizes higher nutrition)
async function getBestFood() {
    for (const foodName of VALID_FOODS) {
        const hasFood = await GetItemInInventory(foodName)
        if (hasFood) {
            console.log(`Found food: ${foodName}`)
            return true
        }
    }
    return false
}

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

// Equip strongest sword
function equipStrongestSword(){
    const strongestSword = getStrongestSword()
    if (strongestSword && bot.heldItem !== strongestSword) {
        bot.equip(strongestSword, 'hand').catch(() => {})
    }
}

function canDoAction(action){
    const now = Date.now();
    const last = LASTACTION.get(action) || 0;
    if (COOLDOWN.get(action) < (now - last)){
        LASTACTION.set(action, now);
        return true;
    }
    return false;
}

function bot_reset(){
    bot.setControlState('sprint', false)
    bot.setControlState('forward', false)
    bot.setControlState('left', false)
    bot.setControlState('right', false)
    bot.setControlState('back', false)
    bot.setControlState('jump', false)
    target = null
    consecutiveMisses = 0 // Reset miss streak on bot reset
    strafeDirection = null // Reset strafe state
    strafeEndTime = 0
    bot.pathfinder.setGoal(null)
    console.log("RESETTING")
}