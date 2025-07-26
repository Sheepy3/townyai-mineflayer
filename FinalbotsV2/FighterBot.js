const mineflayer      = require('mineflayer');
const mcData     = require('minecraft-data')('1.21.4')  // adjust to match your server version
const { pathfinder, Movements, goals } = require('mineflayer-pathfinder')
const armorManager = require('mineflayer-armor-manager')

const Vec3 = require('vec3')

//BOT INSTANCE
const bot = mineflayer.createBot({
  host:'107.138.47.146',//host: '173.73.200.194',
  port: 25565,
  username: 'pvt.asdeoyt@gmail.com',
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
    // Set patrol center to spawn position
    patrolCenter = bot.entity.position.clone()
})

//VARIABLES & CONSTANTS
var state ="IDLE"
var target = null
var lastEnchantedAppleTime = 0 // Track when last enchanted apple was eaten
var lastGoldenAppleTime = 0 // Track when last golden apple was eaten
var patrolCenter = null // Center point for patrol area
var currentPatrolTarget = null // Current patrol destination
const TARGETING_RANGE = 7.5 // Close range targeting
const LINE_OF_SIGHT_RANGE = 25 // Long range line of sight detection
const KITE_RANGE = 50
const REACH_MIN = 2.85 // Minimum attack reach
const REACH_MAX = 3.68 // Maximum attack reach
const MISS_CHANCE_MIN = 0.18 // 18% minimum miss chance
const MISS_CHANCE_MAX = 0.20 // 20% maximum miss chance
const CPS = 13 //sheepy cps
const HEALTH_THRESHOLD = 10
const HUNGER_THRESHOLD = 6
const COOLDOWN = new Map()
const LASTACTION = new Map()

// Ally system constants
const ALLY_LIST = ['xtoa', 'CowardlyFirebo1t'] // Players the bot will not attack
const ALLY_MAX_DISTANCE = 10 // Maximum distance from allied players

// Pearling constants
const PEARL_MIN_DISTANCE = 8 // Minimum distance to start pearling
const PEARL_MAX_DISTANCE = 25 // Maximum effective pearling distance
const PEARL_CLOSE_PROB = 0.15 // 15% chance at close range (8-12 blocks)
const PEARL_MID_PROB = 0.35 // 35% chance at mid range (12-18 blocks)  
const PEARL_FAR_PROB = 0.65 // 65% chance at far range (18-25 blocks)

// Valid food items the bot can eat
const VALID_FOODS = [
    'enchanted_golden_apple',
    'golden_carrot',
    'cooked_beef', // steak
    'cooked_porkchop',
    'golden_apple',
    'cooked_rabbit',
    'cooked_mutton',
    'bread',
    'cooked_cod',
    'baked_potato',
    'cooked_chicken'
]

// COOLDOWNS, time in miliseconds

COOLDOWN.set('attack',1200/CPS) //time between attacks, modify via CPS const
COOLDOWN.set('stateprint',500) // time between console output of state
COOLDOWN.set('gearing',300) // time for gearing process
COOLDOWN.set('healing',1000) // time between healing attempts
COOLDOWN.set('eating',500) // time between eating attempts
COOLDOWN.set('playerCollect',150) // time for player collect gearing
COOLDOWN.set('pearling',2000) // time between enderpearl throws
COOLDOWN.set('enchantedAppleCheck',16000) // 16 seconds between enchanted apple checks
COOLDOWN.set('movementSwing',75) // ~13 CPS for movement swinging
COOLDOWN.set('combatAppleCheck',15000) // 15 seconds average between combat apple checks (10-23s range)
COOLDOWN.set('patrol',24000) // 24 seconds average between patrol movements (16-32s range)
COOLDOWN.set('lookAround',2000) // 2 seconds between look around actions
COOLDOWN.set('patrolMovement',3000) // 3 seconds between patrol movement updates

// to use a cooldown, just put code in an if statement using canDoAction("action name)

/*bot state priority
0. return to ally [NEW] -> if too far from ally, return to them
1. equip armor [implemented] -> gearing system with cooldown
2. heal [implemented] -> check if health below 10, throw splash potions away from target with cooldown. if below 6, double pots
3. eat food [implemented] -> hunger ≤6 interrupts all functions except gearing and healing
4. attack target [implemented] -> basic combat with CPS limiting
5. move to target [implemented] -> pathfinding with sprint and kiting
6. get new target [implemented] -> nearest player within targeting range (excluding allies)
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

bot.on('physicsTick', async () => {
    // Constantly activate item only when eating
    if (state === "EATING") {
        bot.activateItem();
    }
})

bot.on('physicsTick', async () => {
    try {
        //bot decision tree is an if else loop, meaning it can only be in one state at a time. 
        // to add a new state to the front (eg needed for health and hunger) change previous first "if" to an "else if"
        // and add a new if to the front.  
        
        // Eating has highest priority and cannot be interrupted
        if(state == "EATING"){
            // Check if we're still hungry while eating
            if (bot.food > HUNGER_THRESHOLD) {
                // No longer hungry, stop eating
                console.log('No longer hungry, stopping eating')
                state = "IDLE"
                equipStrongestSword()
            }
            return
        }
        // Check if too far from ally - high priority after eating
        else if(isTooFarFromAlly()){
            return_to_ally()
        }
        else if(bot.health < HEALTH_THRESHOLD && canHealSelf()){
            heal()
            
        }
        else if(state === "gearing"){
            gear()
        }
        else if(bot.food <= HUNGER_THRESHOLD && canEatFood()){
            eat()
        }
        else if(target == null){
            get_new_target()
        }
        else if (!target || !target.position || bot.entity.position.distanceTo(target.position) > REACH_MAX){
            if(!target || !target.position || bot.entity.position.distanceTo(target.position) > KITE_RANGE){
                console.log("kited or target lost")
                bot_reset()
                return
            }
            // Check for pearling opportunity before moving
            if(shouldPearl()){
                pearl_to_target()
            } else {
                move_to_target()
            }
        }
        else{
            attack_target()
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
        
        console.log('Started eating - will continue until no longer hungry')
        // Don't reset state here - let it continue until hunger is satisfied
    }
}

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
            
            // Add a short random delay before buffing (between 0.05 and 0.5 seconds)
            const ticks = Math.floor(Math.random() * 10) + 1;
            await bot.waitForTicks(ticks);
          
            // Turn away from target if there is one, otherwise look at feet
            if (target) {
                // Calculate direction away from target
                const awayFromTarget = bot.entity.position.minus(target.position).normalize()
                const lookPosition = bot.entity.position.plus(awayFromTarget.scaled(2))
                await bot.lookAt(lookPosition, true)
                bot.setControlState('forward', true)
            } 
            
            if(bot.health < 7){
                await bot.activateItem(false, new Vec3(0, -1, 0))
                COOLDOWN.set('healing',500) //double pot
            }else{
                await bot.activateItem(false, new Vec3(0, -1, 0))
                COOLDOWN.set('healing',1000)
            }

            // Stop moving forward after throwing
            bot.setControlState('forward', false)

            // Immediately resume normal state after healing and re-equip sword
            state = "IDLE"
            equipStrongestSword()
        } catch (error) {
            console.log('Error during healing:', error.message)
            state = "IDLE"
            equipStrongestSword()
        }
    }
}

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

function get_new_target(){
    state = "LOOKING FOR TARGET"
    
    // Look around for targets
    if (canDoAction("lookAround")) {
        lookAround()
    }
    
    potential_target = get_nearest_enemy_player()
    if (potential_target) {
        const distance = bot.entity.position.distanceTo(potential_target.position)
        
        // Check if target is within close range OR within line of sight range
        if (distance < TARGETING_RANGE || 
            (distance <= LINE_OF_SIGHT_RANGE && canSeeTarget(potential_target))) {
            target = potential_target
            console.log(`Target acquired: ${target.username} at ${Math.floor(distance)} blocks ${distance > TARGETING_RANGE ? '(line of sight)' : '(close range)'}`)
            return
        }
    }
    
    // No target found, patrol only if cooldown allows (16-32 seconds)
    if (canDoAction("patrol")) {
        // Set random cooldown between 16-32 seconds for next patrol
        const nextPatrolCooldown = (16 + Math.random() * 16) * 1000; // 16000-32000ms
        COOLDOWN.set('patrol', nextPatrolCooldown);
        patrol()
    } else {
        // Just sit idle between patrols
        state = "IDLE"
    }
}

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

async function move_to_target(){
    // Check if target still exists and has position
    if (!target || !target.position) {
        console.log("Target lost during movement")
        bot_reset()
        return
    }
    
    state = "MOVING TO TARGET"
    
    // Start moving to target
    bot.setControlState('sprint', true)
    bot.pathfinder.setGoal(new goals.GoalFollow(target, 1))
    
    // Check for enchanted apple eating (15% chance every 16 seconds)
    if (canDoAction("enchantedAppleCheck")) {
        const timeSinceLastApple = Date.now() - lastEnchantedAppleTime
        
        // Only try to eat if it's been more than 30 seconds since last apple
        if (timeSinceLastApple > 30000) {
            const appleChance = Math.random()
            if (appleChance < 0.15) { // 15% chance
                tryEatEnchantedApple()
            }
        } else {
            console.log(`Enchanted apple eaten too recently (${Math.floor((30000 - timeSinceLastApple) / 1000)}s remaining)`)
        }
    }
    
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
    
    // Check for combat apple eating (32% chance every 10-23 seconds)
    if (canDoAction("combatAppleCheck")) {
        // Set random cooldown between 10-23 seconds for next check
        const nextCooldown = (10 + Math.random() * 13) * 1000; // 10000-23000ms
        COOLDOWN.set('combatAppleCheck', nextCooldown);
        
        const appleChance = Math.random()
        if (appleChance < 0.32) { // 32% chance
            tryCombatApple()
        }
    }
    
    // Generate random reach for this attack (between 2.85 - 3.68)
    const currentReach = REACH_MIN + Math.random() * (REACH_MAX - REACH_MIN)
    
    // Generate random miss chance for this attack (between 18% - 20%)
    const currentMissChance = MISS_CHANCE_MIN + Math.random() * (MISS_CHANCE_MAX - MISS_CHANCE_MIN)
    
    if(canDoAction("attack")){
        if (distance <= currentReach) {
            // Within attack range - check for miss
            const missRoll = Math.random()
            if (missRoll < currentMissChance) {
                // Miss - swing but don't attack
                bot.swingArm()
                console.log(`Attack missed! (${(missRoll * 100).toFixed(1)}% roll, ${(currentMissChance * 100).toFixed(1)}% threshold)`)
            } else {
                // Hit - do real damage
                bot.attack(target)
                console.log(`Attack hit! Reach: ${currentReach.toFixed(2)}, Miss chance was: ${(currentMissChance * 100).toFixed(1)}%`)
            }
        } else if (distance <= 8) {
            // Within 8 blocks but outside attack range - fake swing
            fakeSwingAtTarget()
        }
    }
}

function shouldPearl(){
    if (!canDoAction("pearling") || !hasItemInInventory('ender_pearl') || !target || !target.position) {
        return false
    }
    
    const distance = bot.entity.position.distanceTo(target.position)
    
    // Don't pearl if too close or too far
    if (distance < PEARL_MIN_DISTANCE || distance > PEARL_MAX_DISTANCE) {
        return false
    }
    
    let pearlChance = 0
    if (distance <= 12) {
        pearlChance = PEARL_CLOSE_PROB
    } else if (distance <= 18) {
        pearlChance = PEARL_MID_PROB
    } else {
        pearlChance = PEARL_FAR_PROB
    }
    
    return Math.random() < pearlChance
}

async function pearl_to_target(){
    if (!target || !target.position) {
        console.log("Target lost during pearling")
        bot_reset()
        return
    }
    
    state = "PEARLING"
    console.log("Attempting to pearl to target")
    
    try {
        // Equip enderpearl
        const pearl = await GetItemInInventory('ender_pearl')
        if (!pearl) {
            console.log('No enderpearl found')
            state = "IDLE"
            return
        }
        
        // Simple targeting - just aim at the target's current position
        const targetPos = target.position.offset(0, 1, 0) // Aim at body height
        
        // Look at the target position
        await bot.lookAt(targetPos, true)
        
        // Add small random delay for more human-like timing
        const delay = Math.floor(Math.random() * 5) + 1
        await bot.waitForTicks(delay)
        
        // Throw the pearl
        await bot.activateItem()
        console.log("Pearl thrown!")
        
        // Re-equip sword immediately
        equipStrongestSword()
        state = "IDLE"
        
    } catch (error) {
        console.log('Error during pearling:', error.message)
        equipStrongestSword()
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

async function tryEatEnchantedApple() {
    try {
        // Check if bot is already consuming something
        if (bot.entity.metadata[7]) { // metadata[7] indicates if entity is eating/drinking
            console.log("Bot is already consuming something, skipping movement apple")
            return
        }
        
        const hadApple = await GetItemInInventory('enchanted_golden_apple')
        if (hadApple) {
            console.log("Eating enchanted golden apple during movement!")
            await bot.consume()
            lastEnchantedAppleTime = Date.now()
            
            // Re-equip sword after eating
            equipStrongestSword()
        } else {
            console.log("No enchanted golden apple found in inventory")
        }
    } catch (error) {
        console.log('Error eating enchanted apple:', error.message)
        equipStrongestSword()
    }
}

async function tryCombatApple() {
    try {
        // Check if bot is already consuming something
        if (bot.entity.metadata[7]) { // metadata[7] indicates if entity is eating/drinking
            console.log("Bot is already consuming something, skipping combat apple")
            return
        }
        
        const now = Date.now()
        const timeSinceEnchantedApple = now - lastEnchantedAppleTime
        const timeSinceGoldenApple = now - lastGoldenAppleTime
        
        // Check if any apple was eaten within the last 30 seconds
        if (timeSinceEnchantedApple < 30000 || timeSinceGoldenApple < 30000) {
            // Set a random delay of 5-8 seconds before trying again
            const delay = (5 + Math.random() * 3) * 1000; // 5000-8000ms
            COOLDOWN.set('combatAppleCheck', delay);
            console.log(`Apple eaten recently, waiting ${Math.floor(delay/1000)}s before trying again`)
            return
        }
        
        // Try enchanted golden apple first, then regular golden apple
        let hadApple = await GetItemInInventory('enchanted_golden_apple')
        if (hadApple) {
            console.log("Eating enchanted golden apple during combat!")
            await bot.consume()
            lastEnchantedAppleTime = now
            
            // Re-equip sword after eating
            equipStrongestSword()
            return
        }
        
        // If no enchanted apple, try regular golden apple
        hadApple = await GetItemInInventory('golden_apple')
        if (hadApple) {
            console.log("Eating golden apple during combat!")
            await bot.consume()
            lastGoldenAppleTime = now
            
            // Re-equip sword after eating
            equipStrongestSword()
        } else {
            console.log("No golden apples found in inventory for combat eating")
        }
    } catch (error) {
        console.log('Error eating combat apple:', error.message)
        equipStrongestSword()
    }
}

function patrol() {
    state = "PATROLLING"
    
    // If no patrol center set, use current position
    if (!patrolCenter) {
        patrolCenter = bot.entity.position.clone()
    }
    
    // Check if we need a new patrol target or if we're close to current target
    if (!currentPatrolTarget || 
        bot.entity.position.distanceTo(currentPatrolTarget) < 2 || 
        canDoAction("patrolMovement")) {
        
        // Generate random patrol point 3-16 blocks from patrol center
        const angle = Math.random() * Math.PI * 2 // Random angle
        const distance = 3 + Math.random() * 13 // Random distance 3-16 blocks
        
        const x = patrolCenter.x + Math.cos(angle) * distance
        const z = patrolCenter.z + Math.sin(angle) * distance
        const y = patrolCenter.y // Keep same Y level for now
        
        // Fixed: Use new Vec3() instead of bot.vec3()
        currentPatrolTarget = new Vec3(x, y, z)
        console.log(`New patrol destination: ${Math.floor(distance)} blocks from center`)
        
        // Move to new patrol target
        bot.setControlState('sprint', false) // Don't sprint while patrolling
        bot.pathfinder.setGoal(new goals.GoalNear(currentPatrolTarget.x, currentPatrolTarget.y, currentPatrolTarget.z, 1))
    }
    
    // Continue looking around while patrolling
    if (canDoAction("lookAround")) {
        lookAround()
    }
}

function lookAround() {
    // Look in a random direction
    const yaw = Math.random() * Math.PI * 2 // Random horizontal rotation
    const pitch = (Math.random() - 0.5) * 0.5 // Slight up/down look
    
    bot.look(yaw, pitch)
    console.log("Looking around for targets...")
}

//ALLY SYSTEM FUNCTIONS

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

//HELPER FUNCTIONS
function get_nearest_enemy_player(){
    const nearest = bot.nearestEntity(entity =>
        entity.type === 'player' &&
        entity.username !== bot.username &&
        !isAlly(entity.username) // Exclude allies from targeting
      )
    return nearest
}

function canSeeTarget(target) {
    if (!target || !target.position) {
        return false
    }
    
    try {
        // Simple line of sight check using raycasting
        const from = bot.entity.position.offset(0, 1.62, 0) // Bot's eye position
        const to = target.position.offset(0, 1.62, 0) // Target's eye position
        
        // Calculate direction vector
        const direction = to.minus(from).normalize()
        const distance = from.distanceTo(to)
        
        // Check every block along the line for solid blocks
        const stepSize = 0.5 // Check every 0.5 blocks
        for (let i = stepSize; i < distance; i += stepSize) {
            const checkPos = from.plus(direction.scaled(i))
            const block = bot.blockAt(checkPos)
            
            // If we hit a solid block, line of sight is blocked
            if (block && block.type !== 0 && !block.transparent) {
                return false
            }
        }
        
        console.log(`Line of sight confirmed to ${target.username}`)
        return true
        
    } catch (error) {
        // If there's an error with line of sight checking, assume we can't see them
        console.log('Error checking line of sight, assuming blocked')
        return false
    }
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

// Check if bot has any valid food in inventory
function canEatFood() {
    return VALID_FOODS.some(food => hasItemInInventory(food))
}

// Find the best food item to eat (prioritizes higher nutrition)
async function getBestFood() {
    for (const foodName of VALID_FOODS) {
        const hasFood = await GetItemInInventory(foodName)
        if (hasFood) {
            console.log(hasFood)
            return true
        }
    }
    return false
}

function getStrongestSword() { //need to update to match the pattern of getBestFood, for consistency. combine with equipStrongestSword.
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
    target = null
    currentPatrolTarget = null // Reset patrol target too
    bot.pathfinder.setGoal(null)
    console.log("RESETTING")
}