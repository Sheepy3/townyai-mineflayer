const mineflayer      = require('mineflayer');
const mcData     = require('minecraft-data')('1.21.4')  // adjust to match your server version
const { pathfinder, Movements, goals } = require('mineflayer-pathfinder')
const armorManager = require('mineflayer-armor-manager')
const Vec3 = require('vec3')

//BOT INSTANCE
const bot = mineflayer.createBot({
  host:'107.138.47.146',//host: '173.73.200.194',
  port: 25565,
  username: 'Fighterbot5',
  version: '1.21.4',
  auth: 'offline', // or 'mojang' for older versions
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
const TARGETING_RANGE = 25 // Close range targeting

//HITTING CONSTANTS
const REACH_MIN = 2.85 // Minimum attack reach
const REACH_MAX = 3.68 // Maximum attack reach
const MISS_CHANCE_BASE = 0.02 // 18% base miss chance
const MISS_CHANCE_MAX_BASE = 0.12 // 20% maximum base miss chance
const MISS_STREAK_INCREASE_MIN = 0.05 // 5% minimum increase per consecutive miss
const MISS_STREAK_INCREASE_MAX = 0.12 // 12% maximum increase per consecutive miss
const MISS_STREAK_RESET = 5 // Reset miss streak after 5 attempts

//STRAFING CONSTANTS
const LEFT_RIGHT_MIN_MS = 1000;   // 1s
const LEFT_RIGHT_MAX_MS = 3000;   // 3s
const BACK_MS           = 500;    // 0.5s
const JUMP_CHANCE       = 0.02;   // 2%
const JUMP_HOLD_MS      = 50;     // short tap
const CPS = 13 //sheepy cps
const HEALTH_THRESHOLD = 10
const HUNGER_THRESHOLD = 18
const COOLDOWN = new Map()
const LASTACTION = new Map()

// Ally system constants
const ALLY_LIST = ['ADMINBOT'] // Players the bot will not attack
const ALLY_MAX_DISTANCE = 30 // Maximum distance from allied players


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
// Potion drinking cooldowns (in ms)
COOLDOWN.set('drink_36', 95000); // 1 min 35 sec
COOLDOWN.set('drink_15', 95000); // 1 min 35 sec
COOLDOWN.set('drink_12', 480000); // 8 min


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

    // Chat command handler using AdminBot/TownleaderBot parsing style
    bot.on('chat', (username, message) => {
        if (username === bot.username) return;
        const parts = message.trim().split(/\s+/);
        const command = parts[0].toLowerCase();
        const args = parts.slice(1);

        switch (command) {
            case 'gearup':
                state = "gearing";
                bot.chat("Recalling gearing up state and equipping armor.");
                gear();
                break;
            case 'addally':
                if (args.length === 1) {
                    const allyNames = args[0].split(',').map(a => a.trim()).filter(a => a.length > 0);
                    let added = [];
                    let already = [];
                    for (const allyName of allyNames) {
                        if (!ALLY_LIST.some(ally => ally.toLowerCase() === allyName.toLowerCase())) {
                            ALLY_LIST.push(allyName);
                            added.push(allyName);
                        } else {
                            already.push(allyName);
                        }
                    }
                    if (added.length > 0) bot.chat(`Added allies: ${added.join(', ')}`);
                    if (already.length > 0) bot.chat(`Already allies: ${already.join(', ')}`);
                } else {
                    bot.chat('Usage: addally <username1,username2,...>');
                }
                break;
            case 'removeally':
                if (args.length === 1) {
                    const allyNames = args[0].split(',').map(a => a.trim()).filter(a => a.length > 0);
                    let removed = [];
                    let notfound = [];
                    for (const allyName of allyNames) {
                        const idx = ALLY_LIST.findIndex(ally => ally.toLowerCase() === allyName.toLowerCase());
                        if (idx !== -1) {
                            ALLY_LIST.splice(idx, 1);
                            removed.push(allyName);
                        } else {
                            notfound.push(allyName);
                        }
                    }
                    if (removed.length > 0) bot.chat(`Removed allies: ${removed.join(', ')}`);
                    if (notfound.length > 0) bot.chat(`Not in ally list: ${notfound.join(', ')}`);
                } else {
                    bot.chat('Usage: removeally <username1,username2,...>');
                }
                break;
            default:
                // Optionally handle unknown commands
                break;
        }
    });

/*bot state priority
1. equip armor [implemented] -> gearing system with cooldown
2. heal [implemented] -> check if health below 10, throw splash potions away from target with cooldown. if below 7, double pots
3. eat food [implemented] -> hunger ≤18 interrupts all functions except gearing and healing
4. return to ally [implemented] -> if too far from ally, return to them
5. attack target [implemented] -> basic combat with CPS limiting with progressive miss chance
6. move to target [implemented] -> pathfinding with sprint and kiting
7. get new target [implemented] -> nearest player within targeting range (excluding allies)
*/

bot.on('physicsTick', async () => {
    try {

        // Continuous target checking every 2 seconds (except when eating or gearing)
        if (state !== "EATING" && state !== "gearing" && canDoAction("targetCheck")) {
            checkForClosestTarget()
        }

        // Bot state priority: 1. gear -> 2. heal -> 3. eat -> 4. ally -> 5. attack -> 6. move -> 7. target

        if (state === "COMBATBUFFS") {
            // Only healing can interrupt COMBATBUFFS
            if (bot.health < HEALTH_THRESHOLD && canHealSelf()) {
                heal();
            }
            // Otherwise, do nothing until COMBATBUFFS is finished
        } else {
            // 1. Equip armor
            if(state === "gearing"){
                gear()
            }
            // 2. Heal 
            else if(bot.health < HEALTH_THRESHOLD && canHealSelf()){
                heal()
            }
            // 3. Eat food 
            else if(bot.food <= HUNGER_THRESHOLD && canEatFood() || state == "EATING"){
                eat()
            }
            // 4. Return to ally
            else if(isTooFarFromAlly()){
                return_to_ally()
            }
            // 5. Attack target 
            else if(target && target.position && bot.entity.position.distanceTo(target.position) <= REACH_MAX){
                attack_target()
            }
            // 6. Move to target 
            else if(target && target.position){
                move_to_target()
            }
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
    getStrongestSword()
    
    // Reset state after gearing cooldown and ensure sword is equipped
    if (canDoAction("gearing")) {
        state = "IDLE"
        getStrongestSword()
    }
}

// 2. HEAL
async function heal() {
    if (state !="HEALING" && canDoAction("healing")){
        state = "HEALING"

        // Find a splash instant health potion with potionId 25 in inventory
        const splashPotions = bot.inventory.items().filter(item => item.name === 'splash_potion');
        let foundPotion = null;
        for (const item of splashPotions) {
            const potionId = getPotionId(item);
            if (potionId === 25) {
                foundPotion = item;
                break;
            }
        }
        if (!foundPotion) {
            console.log('No healing splash potion with potionId 25 found');
            state = "IDLE";
            return;
        }
        await bot.equip(foundPotion, 'hand');
        
        try {
            // Add a short random delay before healing (between 10 and 11 ticks) 
            const ticks = Math.floor(Math.random() * 10) + 1;
            //await bot.waitForTicks(ticks);
          
            // Turn away from target if there is one and run away while healing
            if (target) {
                // Calculate direction away from target
                await lookAwayFromTarget()
                
                // Start sprinting away from target
                bot.setControlState('sprint', true)
                bot.setControlState('forward', true)
                console.log('Running away from target while healing')
                await bot.waitForTicks(ticks)
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
            getStrongestSword()
            console.log('Healing complete, resuming combat')
        } catch (error) {
            console.log('Error during healing:', error.message)
            // Stop movement on error
            bot.setControlState('sprint', false)
            bot.setControlState('forward', false)
            state = "IDLE"
            getStrongestSword()
        }
    }
}

// 3. EAT FOOD
async function eat() {
    //console.log(bot.food)
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
        if (target && target.position) { // Face away from target and move forward
            try {
                await lookAwayFromTarget()
                bot.setControlState('forward', true);
                bot.setControlState('jump', true);
                bot.setControlState('jump', false);
            } catch (error) {
            }
        } else {
            bot.setControlState('forward', false);
        }
        
    }
    if (bot.food > HUNGER_THRESHOLD) {
        console.log('No longer hungry, stopping eating')
        state = "IDLE"
        getStrongestSword()
        return
    }
    else{
        console.log(bot.food)
    }
    bot.activateItem()

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
        } /*else if (distance <= 8) {
            // Within 8 blocks but outside attack range - fake swing
            fakeSwingAtTarget()
        }*/
    }
}

// Handle strafing substate during combat
function handleStrafing () {
   

    const stopAllStrafe = () => {
      bot.setControlState('left',  false)
      bot.setControlState('right', false)
      bot.setControlState('back',  false)
      strafeDirection = null
    }
  
    const startStrafe = (dir, durationMs) => {
      // clean start
      stopAllStrafe()
      bot.setControlState(dir, true)
      strafeDirection = dir
      // prime a cooldown
      COOLDOWN.set('strafeHold', durationMs)
      LASTACTION.set('strafeHold', Date.now())
    }

    // ------- End current strafe when its hold cooldown elapses -------
    if (strafeDirection && canDoAction('strafeHold')) {
      stopAllStrafe()
      console.log('Strafe movement ended')
    }
  
    // new strafe decision
    if (canDoAction('strafeDecision')) {
      const choice = ['left', 'right', 'back', 'none'][Math.floor(Math.random() * 4)]
  
      switch (choice) {
        case 'left': {
          const dur = LEFT_RIGHT_MIN_MS + Math.random() * (LEFT_RIGHT_MAX_MS - LEFT_RIGHT_MIN_MS)
          startStrafe('left', dur)
          console.log(`Started strafing left for ${(dur / 1000).toFixed(1)}s`)
          break
        }
        case 'right': {
          const dur = LEFT_RIGHT_MIN_MS + Math.random() * (LEFT_RIGHT_MAX_MS - LEFT_RIGHT_MIN_MS)
          startStrafe('right', dur)
          console.log(`Started strafing right for ${(dur / 1000).toFixed(1)}s`)
          break
        }
        case 'back': {
          startStrafe('back', BACK_MS)
          console.log('Started backing up for 0.5s')
          break
        }
        default: {
          stopAllStrafe()
          console.log('No strafe movement this cycle')
          break
        }
      }
    }
    //
    if (!strafeDirection) return
    if (Math.random() >= JUMP_CHANCE) return
    bot.setControlState('jump', true)
    setTimeout(() => bot.setControlState('jump', false), JUMP_HOLD_MS)
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

function idle() {
    // Look in a random direction
    const yaw = Math.random() * Math.PI * 2 // Random horizontal rotation
    const pitch = (Math.random() - 0.5) * 0.5 // Slight up/down look
    
    bot.look(yaw, pitch)
    console.log("Looking around for targets...")
}

//HELPER FUNCTIONS
async function lookAwayFromTarget(){
    if (!target || !target.position) return;
    const awayFromTarget = bot.entity.position.minus(target.position).normalize();
    const lookPosition = bot.entity.position.plus(awayFromTarget.scaled(5));
    bot.lookAt(lookPosition, true).catch(() => {});
}

function checkForClosestTarget() {
    const players = Object.values(bot.players)
        .map(player => player.entity)
        .filter(entity => 
            entity && 
            entity.type === 'player' &&
            entity.username !== bot.username &&
            !isAlly(entity.username) &&
            entity.position
        )
    
    if (players.length === 0){
        if (target) {
            console.log("No enemies detected - Resetting")
            bot_reset()
        }
        return
    } 
    
    // Find the closest enemy player
    let closestEnemy = null
    let closestDistance = Infinity
    
    for (const player of players) {
        const distance = bot.entity.position.distanceTo(player.position)
        if (distance < closestDistance) {
            closestDistance = distance
            closestEnemy = player
        }
    }
    
    // Only engage targets within range
    if (closestDistance > TARGETING_RANGE) {
        if (target) {
            console.log(`Closest enemy ${closestEnemy.username} too far (${Math.floor(closestDistance)} blocks) - Resetting`)
            bot_reset()
        }
        return
    }
    
    // Check if we need to switch targets
    if (!target || target.id !== closestEnemy.id) {
        const previousTarget = target ? target.username : "none"
        target = closestEnemy
        console.log(`Target switch: ${previousTarget} → ${target.username} at ${Math.floor(closestDistance)} blocks (closest enemy)`)
        attemptDrinkBuffPotions();
    }
}

function isAlly(playerName) {
    if (!playerName) return false;
    return ALLY_LIST.some(ally => ally.toLowerCase() === playerName.toLowerCase());
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

function getPotionId(item) { //unused
    const comp = item.components?.find(c => c.type === 'potion_contents')
    return comp?.data?.potionId
}

// Buff logic: checks for any splash instant health potion (strong or regular)
function canHealSelf() {
    // Only return true if splash potion with potionId 25 is present
    const splashPotions = bot.inventory.items().filter(item => item.name === 'splash_potion');
    for (const item of splashPotions) {
        if (getPotionId(item) === 25) return true;
    }
    return false;
}

// Check if bot has any valid food
function canEatFood() {
    return getBestFood()
}

// Find the best food item to eat (prioritizes higher nutrition)
function getBestFood() {
    
    const foodOrder = [
        'enchanted_golden_apple',
        'golden_apple',
        'golden_carrot',
        'cooked_beef', // steak
        'cooked_porkchop',
        'cooked_chicken',
        'cooked_rabbit',
        'cooked_mutton',
        'bread',
        'cooked_cod',
        'baked_potato',
        
    ]

    const foods = bot.inventory.items().filter(item => foodOrder.includes(item.name))
    if (foods.length === 0) return false
    
    foods.sort((a, b) => foodOrder.indexOf(a.name) - foodOrder.indexOf(b.name))
    bestFood = foods[0]
    bot.equip(bestFood, 'hand').catch(() => {})
    return true
}

function getStrongestSword() {
    const swordOrder = [
        'netherite_sword',
        'diamond_sword',
        'iron_sword',
        'stone_sword',
        'golden_sword',
        'wooden_sword'
    ]
    const swords = bot.inventory.items().filter(item => swordOrder.includes(item.name))
    if (swords.length === 0) return false

    swords.sort((a, b) => swordOrder.indexOf(a.name) - swordOrder.indexOf(b.name))
    strongestSword = swords[0]
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
    state = "IDLE"
    attemptDrinkBuffPotions();
}
// Attempt to drink buff potions (IDs: 36, 15, 12) with cooldowns
async function attemptDrinkBuffPotions() {
    const now = Date.now();
    const potionsToDrink = [
        { id: 36, cooldownKey: 'drink_36' },
        { id: 15, cooldownKey: 'drink_15' },
        { id: 12, cooldownKey: 'drink_12' }
    ];
    // Set state to COMBATBUFFS
    state = "COMBATBUFFS";
    // Stop movement while drinking potions
    bot.setControlState('sprint', false);
    bot.setControlState('forward', false);
    bot.setControlState('left', false);
    bot.setControlState('right', false);
    bot.setControlState('back', false);
    bot.setControlState('jump', false);

    for (const { id, cooldownKey } of potionsToDrink) {
        // Always check the latest ally list and cooldowns
        const last = LASTACTION.get(cooldownKey) || 0;
        const isCooldownReady = COOLDOWN.get(cooldownKey) < (Date.now() - last);
        const isValidTarget = target && target.username && !isAlly(target.username);
        if (isCooldownReady && isValidTarget) {
            // Find all matching potions in inventory
            const potions = bot.inventory.items().filter(item => item.name === 'potion' && getPotionId(item) === id);
            for (const item of potions) {
                // Move away from target before drinking
                await lookAwayFromTarget();
                bot.setControlState('sprint', true);
                bot.setControlState('forward', true);
                await new Promise(res => setTimeout(res, 1000));
                bot.setControlState('sprint', false);
                bot.setControlState('forward', false);
                await bot.equip(item, 'hand');
                await bot.activateItem();
                // Wait for drinking animation to finish (2 seconds typical)
                await new Promise(res => setTimeout(res, 2000));
                LASTACTION.set(cooldownKey, Date.now());
                bot.chat(`Drank potion ID ${id}`);
                // Re-equip strongest sword after drinking
                getStrongestSword();
            }
        }
    }
    // Return to previous state after buffs (if needed)
    state = "IDLE";
}