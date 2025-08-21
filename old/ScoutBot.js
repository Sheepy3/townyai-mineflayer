const mineflayer      = require('mineflayer');
const mcData     = require('minecraft-data')('1.21.4')  // adjust to match your server version
const { pathfinder, Movements, goals } = require('mineflayer-pathfinder')
const armorManager = require('mineflayer-armor-manager')
const Vec3 = require('vec3')

//BOT INSTANCE
const bot = mineflayer.createBot({
  host:'107.138.47.146',//host: '173.73.200.194',
  port: 25565,
  username: 'Scout',
  version: '1.21.4',
  auth: 'offline', // or 'mojang' for older versions
});

//PLUGINS
bot.loadPlugin(pathfinder)
bot.loadPlugin(armorManager)

// Configure pathfinder movements with block breaking/placing
bot.once('spawn', () => {
    console.log('Bot spawned and starting initial gearing.')
    state = "gearing"
    
    // Configure pathfinder to break/place blocks
    const movements = new Movements(bot, mcData)
    movements.canDig = true // Allow breaking blocks
    movements.scafoldingBlocks = ['dirt', 'cobblestone', 'stone'] // Blocks to place for scaffolding
    movements.allow1by1towers = true // Allow building 1x1 towers
    movements.allowFreeMotion = true // Allow more complex movements
    movements.allowParkour = true // Allow parkour movements
    movements.allowSprinting = true // Allow sprinting
    
    bot.pathfinder.setMovements(movements)
})

// Initial gearing on spawn
bot.once('spawn', () => {
    console.log('Bot spawned and starting initial gearing.')
    state = "gearing"
})

//VARIABLES & CONSTANTS
var state = "IDLE"
var target = null
var scoutingTarget = null // Player we're scouting
var reportedBases = new Set() // Track reported base coordinates to avoid spam
var wanderGoal = null
var lastWanderTime = 0
const TARGETING_RANGE = 25 // Detection range for players
const SCOUT_RANGE = 100 // How far to scout around a detected player
const DEFEND_RANGE = 4 // Only defend if entity is within 4 blocks
const FLEE_RANGE = 15 // Start fleeing if enemy is within 15 blocks
const REACH_MIN = 2.85 // Minimum attack reach
const REACH_MAX = 3.68 // Maximum attack reach
const CPS = 13 // Attack speed when defending
const HEALTH_THRESHOLD = 10
const HUNGER_THRESHOLD = 18
const COOLDOWN = new Map()
const LASTACTION = new Map()

// Ally system constants - scouts ignore these players
const ALLY_LIST = ['Scout'] // Players the bot will not report or attack

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

// COOLDOWNS, time in milliseconds 
COOLDOWN.set('attack', 1000/CPS) // time between attacks when defending
COOLDOWN.set('stateprint', 2000) // less frequent state printing
COOLDOWN.set('gearing', 500) // time for gearing process
COOLDOWN.set('healing', 1000) // time between healing attempts
COOLDOWN.set('eating', 500) // time between eating attempts
COOLDOWN.set('playerCollect', 250) // time for player collect gearing
COOLDOWN.set('wander', 10000) // 10 seconds between wander decisions
COOLDOWN.set('baseReport', 30000) // 30 seconds between base reports for same area
COOLDOWN.set('scoutCheck', 3000) // 3 seconds between scout checks
COOLDOWN.set('scoutMove', 45000) // 45 seconds between scout movements
COOLDOWN.set('blockBreak', 100) // 100ms between block breaks
COOLDOWN.set('blockPlace', 200) // 200ms between block placements

/*scout bot state priority
1. equip armor [implemented] -> gearing system with cooldown
2. heal [implemented] -> check if health below 10, throw splash potions away from target
3. eat food [implemented] -> hunger ≤18 interrupts all functions except gearing and healing
4. flee from enemies [new] -> run away if enemy within 15 blocks
5. defend self [modified] -> only attack if enemy within 5 blocks
6. scout area [new] -> when player detected, explore around their location
7. wander [new] -> random exploration to find bases
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
        // Continuous scouting checks every 3 seconds
        if (canDoAction("scoutCheck")) {
            checkForPlayersToScout()
        }

        // Scout bot state priority: 1. gear -> 2. heal -> 3. eat -> 4. flee -> 5. defend -> 6. scout -> 7. wander
        
        // 1. Equip armor - highest priority
        if(state === "gearing"){
            gear()
        }
        // 2. Heal - second priority
        else if(bot.health < HEALTH_THRESHOLD && canHealSelf()){
            heal()
        }
        // 3. Eat food - third priority
        else if(bot.food <= HUNGER_THRESHOLD && canEatFood()){
            eat()
        }
        // Special handling for eating state
        else if(state == "EATING"){
            if (bot.food > HUNGER_THRESHOLD) {
                console.log('No longer hungry, stopping eating')
                state = "IDLE"
                equipStrongestSword()
            }
            return
        }
        // 4. Flee from enemies - fourth priority
        else if(shouldFlee()){
            flee_from_enemies()
        }
        // 5. Defend self - fifth priority (only if cornered)
        else if(shouldDefend()){
            defend_self()
        }
        // 6. Scout area - sixth priority
        else if(scoutingTarget && scoutingTarget.position){
            scout_area()
        }
        // 7. Wander - lowest priority
        else{
            wander_and_explore()
        }

        //logging
        if (canDoAction("stateprint")){
            console.log(`${state} | Scouting: ${scoutingTarget ? scoutingTarget.username : 'none'} | Reported bases: ${reportedBases.size}`)
        }
    } catch (error) {
        console.log('Physics tick error:', error.message)
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

// 4. FLEE FROM ENEMIES
function flee_from_enemies() {
    state = "FLEEING FROM ENEMIES"
    
    const nearestEnemy = get_nearest_enemy_player()
    if (!nearestEnemy) {
        state = "IDLE"
        return
    }
    
    // Calculate direction away from enemy
    const awayFromEnemy = bot.entity.position.minus(nearestEnemy.position).normalize()
    const fleeTarget = bot.entity.position.plus(awayFromEnemy.scaled(20))
    
    console.log(`Fleeing from ${nearestEnemy.username} at distance ${Math.floor(bot.entity.position.distanceTo(nearestEnemy.position))}`)
    
    // Sprint away
    bot.setControlState('sprint', true)
    bot.pathfinder.setGoal(new goals.GoalNear(fleeTarget.x, fleeTarget.y, fleeTarget.z, 1))
}

// 5. DEFEND SELF (only when cornered)
function defend_self() {
    const nearestEnemy = get_nearest_enemy_player()
    if (!nearestEnemy || !nearestEnemy.position) {
        state = "IDLE"
        return
    }
    
    state = "DEFENDING SELF"
    
    // Look at the target's eye level
    const eyePos = nearestEnemy.position.offset(0, 1.62, 0);
    bot.lookAt(eyePos);
    
    const distance = bot.entity.position.distanceTo(nearestEnemy.position)
    
    console.log(`Cornered! Defending against ${nearestEnemy.username} at distance ${Math.floor(distance)}`)
    
    if(canDoAction("attack") && distance <= REACH_MAX){
        bot.attack(nearestEnemy)
        console.log(`Defensive attack on ${nearestEnemy.username}`)
    }
}

// 6. SCOUT AREA
function scout_area() {
    if (!scoutingTarget || !scoutingTarget.position) {
        scoutingTarget = null
        state = "IDLE"
        return
    }
    
    state = "SCOUTING AREA"
    
    const distance = bot.entity.position.distanceTo(scoutingTarget.position)
    
    // Report base location if we haven't already
    const baseKey = `${Math.floor(scoutingTarget.position.x/10)*10},${Math.floor(scoutingTarget.position.z/10)*10}`
    if (!reportedBases.has(baseKey) && canDoAction("baseReport")) {
        reportedBases.add(baseKey)
        const coords = `${Math.floor(scoutingTarget.position.x)}, ${Math.floor(scoutingTarget.position.y)}, ${Math.floor(scoutingTarget.position.z)}`
        bot.chat(`SCOUT REPORT: Player base detected at ${coords} - Player: ${scoutingTarget.username}`)
        console.log(`Reported base: ${coords}`)
    }
    
    // Move to random blocks within 5-120 range every 45 seconds
    if (canDoAction("scoutMove")) {
        const scoutDistance = 5 + Math.random() * 115 // 5-120 blocks
        const angle = Math.random() * Math.PI * 2
        
        const scoutGoal = bot.entity.position.offset(
            Math.cos(angle) * scoutDistance,
            0,
            Math.sin(angle) * scoutDistance
        )
        
        console.log(`Scouting movement: ${Math.floor(scoutDistance)} blocks to ${Math.floor(scoutGoal.x)}, ${Math.floor(scoutGoal.z)}`)
        
        bot.setControlState('sprint', true)
        // Use pathfinder goal that allows block breaking/placing
        const movements = new Movements(bot, mcData)
        movements.canDig = true
        movements.scafoldingBlocks = getScaffoldingBlocks()
        bot.pathfinder.setMovements(movements)
        bot.pathfinder.setGoal(new goals.GoalNear(scoutGoal.x, scoutGoal.y, scoutGoal.z, 5))
    }
    
    // End scouting if target is too far or lost
    if (distance > SCOUT_RANGE) {
        console.log(`Scouting complete for ${scoutingTarget.username}, resuming wandering`)
        scoutingTarget = null
        state = "IDLE"
    }
}

// 7. WANDER AND EXPLORE
function wander_and_explore() {
    state = "WANDERING"
    
    // Set new wander goal every 10 seconds
    if (canDoAction("wander") || !wanderGoal) {
        // Generate random coordinates within reasonable range
        const wanderDistance = 50 + Math.random() * 100 // 50-150 blocks away
        const angle = Math.random() * Math.PI * 2
        
        wanderGoal = bot.entity.position.offset(
            Math.cos(angle) * wanderDistance,
            0,
            Math.sin(angle) * wanderDistance
        )
        
        console.log(`New wander target: ${Math.floor(wanderGoal.x)}, ${Math.floor(wanderGoal.z)}`)
        
        bot.setControlState('sprint', true)
        // Configure movements for wandering with block breaking
        const movements = new Movements(bot, mcData)
        movements.canDig = true
        movements.scafoldingBlocks = getScaffoldingBlocks()
        movements.allowFreeMotion = true
        bot.pathfinder.setMovements(movements)
        bot.pathfinder.setGoal(new goals.GoalNear(wanderGoal.x, wanderGoal.y, wanderGoal.z, 10))
    }
}

//HELPER FUNCTIONS

function checkForPlayersToScout() {
    const nearestPlayer = get_nearest_enemy_player()
    
    if (!nearestPlayer) {
        // No players detected
        return
    }
    
    const distance = bot.entity.position.distanceTo(nearestPlayer.position)
    
    // If we detect a player and aren't already scouting them
    if (distance <= TARGETING_RANGE && (!scoutingTarget || scoutingTarget.id !== nearestPlayer.id)) {
        scoutingTarget = nearestPlayer
        console.log(`New scouting target detected: ${nearestPlayer.username} at ${Math.floor(distance)} blocks`)
    }
}

function shouldFlee() {
    const nearestEnemy = get_nearest_enemy_player()
    if (!nearestEnemy) return false
    
    const distance = bot.entity.position.distanceTo(nearestEnemy.position)
    return distance <= FLEE_RANGE && distance > DEFEND_RANGE
}

function shouldDefend() {
    const nearestEnemy = get_nearest_enemy_player()
    if (!nearestEnemy) return false
    
    const distance = bot.entity.position.distanceTo(nearestEnemy.position)
    return distance <= DEFEND_RANGE
}

function get_nearest_enemy_player(){
    const players = Object.values(bot.players)
        .map(player => player.entity)
        .filter(entity => 
            entity && 
            entity.type === 'player' &&
            entity.name !== bot.username && // Filter out bot itself
            entity.username !== bot.username && // Also check username property
            !isAlly(entity.name || entity.username) && // Check both name properties for allies
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
    scoutingTarget = null
    wanderGoal = null
    bot.pathfinder.setGoal(null)
    console.log("SCOUT RESET")
}

function isAlly(playerName) {
    // Also check if it's the bot itself
    if (playerName === bot.username) return true
    return ALLY_LIST.includes(playerName)
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

// Get available scaffolding blocks from inventory
function getScaffoldingBlocks() {
    const availableBlocks = []
    const scaffoldingTypes = ['dirt', 'cobblestone', 'stone', 'netherrack', 'sandstone', 'oak_planks', 'birch_planks', 'spruce_planks']
    
    for (const blockType of scaffoldingTypes) {
        if (hasItemInInventory(blockType)) {
            availableBlocks.push(blockType)
        }
    }
    
    // If no scaffolding blocks available, return empty array (pathfinder will work without placing blocks)
    return availableBlocks
}

// Manual block breaking function for emergencies
async function breakBlockAtPosition(position) {
    if (!canDoAction("blockBreak")) return false
    
    try {
        const block = bot.blockAt(position)
        if (!block || block.name === 'air') return false
        
        // Don't break bedrock or other unbreakable blocks
        const unbreakableBlocks = ['bedrock', 'barrier', 'end_portal', 'end_portal_frame']
        if (unbreakableBlocks.includes(block.name)) return false
        
        console.log(`Breaking ${block.name} at ${position}`)
        await bot.dig(block)
        return true
    } catch (error) {
        console.log('Error breaking block:', error.message)
        return false
    }
}

// Manual block placing function
async function placeBlockAtPosition(position, blockType = 'dirt') {
    if (!canDoAction("blockPlace")) return false
    if (!hasItemInInventory(blockType)) return false
    
    try {
        const targetBlock = bot.blockAt(position)
        if (!targetBlock || targetBlock.name !== 'air') return false
        
        // Find a reference block to place against
        const referenceBlock = bot.blockAt(position.offset(0, -1, 0)) // Try below first
        if (!referenceBlock || referenceBlock.name === 'air') return false
        
        console.log(`Placing ${blockType} at ${position}`)
        await bot.equip(bot.inventory.items().find(item => item.name === blockType), 'hand')
        await bot.placeBlock(referenceBlock, new Vec3(0, 1, 0))
        return true
    } catch (error) {
        console.log('Error placing block:', error.message)
        return false
    }
}