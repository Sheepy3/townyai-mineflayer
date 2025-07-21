const mineflayer      = require('mineflayer');
const mcData     = require('minecraft-data')('1.21.4')  // adjust to match your server version
const { pathfinder, Movements, goals } = require('mineflayer-pathfinder')
const armorManager = require('mineflayer-armor-manager')

//const Vec3 = require('vec3')

//BOT INSTANCE
const bot = mineflayer.createBot({
  host:'173.73.200.194',//host: '173.73.200.194',
  port: 25565,
  username: 'Fighter',
  version: '1.21.4',
  auth: 'offline'
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
var state ="idle"
var target = null
var healing = false
var eating = false
const TARGETING_RANGE = 10
const KITE_RANGE = 50
const REACH = 3
const CPS = 3 //sheepy cps
const HEALTH_THRESHOLD = 10
const HUNGER_THRESHOLD = 3
const COOLDOWN = new Map()
const LASTACTION = new Map()

// COOLDOWNS, time in miliseconds

COOLDOWN.set('attack',1000/CPS) //time between attacks, modify via CPS const
COOLDOWN.set('stateprint',500) // time between console output of state
COOLDOWN.set('gearing',500) // time for gearing process
COOLDOWN.set('healing',350) // time between healing attempts
COOLDOWN.set('eating',2000) // time between eating attempts
COOLDOWN.set('playerCollect',250) // time for player collect gearing

// to use a cooldown, just put code in an if statement using canDoAction("action name)

/*bot state priority
0. equip armor [implemented] -> gearing system with cooldown
1. heal [implemented] -> check if health below 10, throw splash potions away from target with cooldown
2. eat food [implemented] -> hunger ≤3 interrupts all functions except gearing and healing
3. attack target [implemented] -> basic combat with CPS limiting
4. move to target [implemented] -> pathfinding with sprint and kiting
5. get new target [implemented] -> nearest player within targeting range
*/

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
    //bot decision tree is an if else loop, meaning it can only be in one state at a time. 
    // to add a new state to the front (eg needed for health and hunger) change previous first "if" to an "else if"
    // and add a new if to the front.  
    if(bot.health < HEALTH_THRESHOLD && canBuffSelf()){
        heal()
    }
    else if(state === "gearing"){
        gear()
    }
    else if(bot.food <= HUNGER_THRESHOLD && canEatFood()){
        // Hunger at 3 or below - interrupt all functions except gearing and healing
        eat()
    }
    else if(target == null){
        get_new_target()
    }
    else if (bot.entity.position.distanceTo(target.position) > REACH){
        if(bot.entity.position.distanceTo(target.position) > KITE_RANGE){
            console.log("kited")
            bot_reset()
            return
        }
        move_to_target()
    }
    else{
        attack_target()
    }

    //logging
    if (canDoAction("stateprint")){
        console.log(state)
    }else{
    
    }
});

//STATE FUNCTIONS

function eat(){
    if (!eating && canDoAction("eating")) {
        eating = true
        state = "EATING"
        consumeFood()
    }
}

function heal(){
    if (!healing && canDoAction("healing")) {
        healing = true
        state = "HEALING"
        throwInstantHealth()
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
        state = "idle"
        equipStrongestSword()
    }
}

function get_new_target(){
    state = "LOOKING FOR TARGET"
    potential_target = get_nearest_player()
    if (potential_target && 
        bot.entity.position.distanceTo(potential_target.position) < TARGETING_RANGE){
            target = potential_target  
        } 
}

function move_to_target(){
    state = "MOVING TO TARGET"
    bot.setControlState('sprint', true)
    bot.pathfinder.setGoal(new goals.GoalFollow(target, 1))
}

function attack_target(){
    state = "ATTACKING TARGET"
    // Look at the target's eye level (1.62 above position.y for players)
    const eyePos = target.position.offset(0, 1.62, 0);
    bot.lookAt(eyePos);
    if(canDoAction("attack")){
        bot.attack(target)
    }
}

//HELPER FUNCTIONS

function get_nearest_player(){
    const nearest = bot.nearestEntity(entity =>
        entity.type === 'player' &&
        entity.username !== bot.username
      )
    return nearest
}

// Shared helper function for finding items in inventory
function findItemInInventory(itemName) {
    return bot.inventory.items().find(item => item.name === itemName)
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
function canBuffSelf() {
    return hasItemInInventory('splash_potion')
}

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

// Check if bot has any valid food in inventory
function canEatFood() {
    return VALID_FOODS.some(food => hasItemInInventory(food))
}

// Find the best food item to eat (prioritizes higher nutrition)
function getBestFood() {
    // Priority order (best nutrition first)
    const foodPriority = [
        'enchanted_golden_apple',
        'golden_apple',
        'golden_carrot',
        'cooked_beef',
        'cooked_porkchop',
        'cooked_mutton',
        'cooked_chicken',
        'cooked_rabbit',
        'cooked_cod',
        'baked_potato',
        'bread'
    ]
    
    for (const food of foodPriority) {
        const item = findItemInInventory(food)
        if (item) return item
    }
    return null
}

async function consumeFood() {
    const food = getBestFood()
    
    if (!food) {
        console.log('No valid food found in inventory')
        eating = false
        state = "idle"
        return
    }
    
    try {
        // Equip the food item
        await bot.equip(food, 'hand')
        
        // Start eating
        await bot.consume()
        
        console.log(`Consumed ${food.name}`)
        
        // Reset eating state and re-equip sword
        eating = false
        state = "idle"
        equipStrongestSword()
    } catch (error) {
        console.log('Error while eating:', error.message)
        eating = false
        state = "idle"
        equipStrongestSword()
    }
}

async function throwInstantHealth() {
    // 1. Find a splash instant health potion in inventory
    const potion = findItemInInventory('splash_potion')

    if (!potion) {
        console.log('No healing splash potion found')
        healing = false
        return
    }
    
    try {
        // 2. Equip it in hand
        await bot.equip(potion, 'hand')

        // Add a short random delay before buffing (between 0.05 and 0.5 seconds)
        const delayMs = 20 + Math.random() * 250
        await new Promise(resolve => setTimeout(resolve, delayMs))

        // 3. Turn away from target if there is one, otherwise look at feet
        if (target) {
            // Calculate direction away from target
            const awayFromTarget = bot.entity.position.minus(target.position).normalize()
            const lookPosition = bot.entity.position.plus(awayFromTarget.scaled(2))
            await bot.lookAt(lookPosition, true)
        } else {
            // Look at the block at your feet if no target
            const feetBlock = bot.blockAt(bot.entity.position.offset(0, -1, 0))
            if (feetBlock) {
                await bot.lookAt(feetBlock.position, true)
            }
        }
        
        await bot.waitForTicks(5)
        
        const Vec3 = require('vec3')
        await bot.activateItem(false, new Vec3(0, -1, 0))
        console.log('Threw a splash instant health potion at my feet!')

        // 5. Stop moving forward after throwing
        bot.setControlState('forward', false)

        // 6. Immediately resume normal state after healing and re-equip sword
        healing = false
        state = "idle"
        equipStrongestSword()
    } catch (error) {
        console.log('Error during healing:', error.message)
        healing = false
        state = "idle"
        equipStrongestSword()
    }
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
    target = null
    healing = false
    eating = false
    bot.pathfinder.setGoal(null)
    console.log("RESETTING")
}
